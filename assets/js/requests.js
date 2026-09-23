// ═══════════════════════════════════════════════════════════
//  Material requests — students ask for a chapter, the admin
//  reviews and (eventually) makes it.
//
//  Requests are private: readable by their author and the admin
//  only, the same shape as orders. Making them public would mean
//  exposing every student's email and what they're stuck on to
//  everyone else, for the sake of a vote count the admin can get
//  just by seeing four requests for the same chapter.
// ═══════════════════════════════════════════════════════════
import {
  db, doc, addDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where
} from './firebase.js';

export const REQ_STATUS = {
  OPEN:      'open',        // waiting for the admin to look at it
  PLANNED:   'planned',     // accepted, on the list to make
  FULFILLED: 'fulfilled',   // the material now exists
  DECLINED:  'declined',    // not going to be made
  WITHDRAWN: 'withdrawn'    // the student changed their mind
};

export const REQ_META = {
  [REQ_STATUS.OPEN]:      { label: 'Waiting for review', badge: 'badge-amber'  },
  [REQ_STATUS.PLANNED]:   { label: 'Planned',            badge: 'badge-blue'   },
  [REQ_STATUS.FULFILLED]: { label: 'Ready',              badge: 'badge-green'  },
  [REQ_STATUS.DECLINED]:  { label: 'Declined',           badge: 'badge-red'    },
  [REQ_STATUS.WITHDRAWN]: { label: 'Withdrawn',          badge: 'badge-grey'   }
};

/** Keeps one enthusiastic student from flooding the queue. */
export const MAX_OPEN_PER_STUDENT = 5;

export const LIMITS = { subject: 60, chapter: 140, details: 1000 };

export const REQ_KIND = { MATERIAL: 'material', SAMPLE: 'sample' };

export function validate({ subject, chapter, details }) {
  const errors = [];
  if (!chapter || !chapter.trim()) errors.push('Tell us which chapter or topic you need.');
  if ((chapter || '').length > LIMITS.chapter) errors.push('Chapter is too long.');
  if ((subject || '').length > LIMITS.subject) errors.push('Subject is too long.');
  if ((details || '').length > LIMITS.details) errors.push('Details are too long.');
  return errors;
}

export async function listMyRequests(email) {
  // Filtered in the query, not after: rules cannot narrow a
  // collection read, so an unfiltered fetch would be rejected.
  const snap = await getDocs(query(
    collection(db, 'requests'),
    where('email', '==', email.toLowerCase())
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAllRequests() {
  const snap = await getDocs(collection(db, 'requests'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createRequest({ email, name, subject, chapter, details }) {
  const errors = validate({ subject, chapter, details });
  if (errors.length) throw new Error(errors[0]);

  const mine = await listMyRequests(email);
  const open = mine.filter(r => r.status === REQ_STATUS.OPEN).length;
  if (open >= MAX_OPEN_PER_STUDENT) {
    throw new Error(
      `You already have ${open} requests waiting for review. ` +
      `Withdraw one before adding another.`);
  }

  const ref = await addDoc(collection(db, 'requests'), {
    email: email.toLowerCase(),
    name: (name || '').trim(),
    subject: (subject || '').trim(),
    chapter: chapter.trim(),
    details: (details || '').trim(),
    status: REQ_STATUS.OPEN,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  return ref.id;
}

/**
 * "Can I see a sample first?" — one per person, ever.
 *
 * Not per material: the point is to let a new student try the
 * teaching once before paying for anything, so it is a single ask
 * tied to the person rather than a catalogue of previews.
 *
 * The limit is enforced here and shown in the UI, not in the rules.
 * A second ask costs nothing but the admin's time to decline, and
 * keeping it out of the rules avoids a republish for a free trial.
 */
export async function createFreeSampleRequest({ email, name, note }) {
  // The rules cap details at 1000 chars. Checking here turns a bare
  // permission-denied into a sentence the student can act on.
  if ((note || '').length > LIMITS.details) {
    throw new Error(`Keep the note under ${LIMITS.details} characters.`);
  }

  const existing = await findMySampleRequest(email);
  if (existing) {
    throw new Error(existing.status === REQ_STATUS.FULFILLED
      ? 'You have already had your free sample.'
      : 'Your sample request is already with your instructor.');
  }

  const ref = await addDoc(collection(db, 'requests'), {
    email: email.toLowerCase(),
    name: (name || '').trim(),
    kind: REQ_KIND.SAMPLE,
    subject: '',
    chapter: 'Free sample',
    details: (note || '').trim(),
    status: REQ_STATUS.OPEN,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  return ref.id;
}

/** The one sample request this person has, if any. */
export async function findMySampleRequest(email) {
  const mine = await listMyRequests(email);
  return mine.find(r => r.kind === REQ_KIND.SAMPLE &&
    r.status !== REQ_STATUS.WITHDRAWN && r.status !== REQ_STATUS.DECLINED) || null;
}

/** The student's only write after creating: walking it back. */
export async function withdrawRequest(id) {
  await updateDoc(doc(db, 'requests', id), {
    status: REQ_STATUS.WITHDRAWN,
    updatedAt: Date.now()
  });
}

/* ── admin ────────────────────────────────────────────── */

export async function setRequestStatus(id, status, adminNote) {
  await updateDoc(doc(db, 'requests', id), {
    status,
    ...(adminNote !== undefined ? { adminNote } : {}),
    updatedAt: Date.now()
  });
}

/** Mark it done and point the student at the material that answers it. */
export async function fulfilRequest(id, materialId, adminNote) {
  await updateDoc(doc(db, 'requests', id), {
    status: REQ_STATUS.FULFILLED,
    materialId: materialId || null,
    ...(adminNote !== undefined ? { adminNote } : {}),
    fulfilledAt: Date.now(),
    updatedAt: Date.now()
  });
}

export async function deleteRequest(id) {
  await deleteDoc(doc(db, 'requests', id));
}

/**
 * The work queue: every live request, grouped so the same chapter
 * asked by several students is one item rather than duplicates.
 *
 * Ordered by how many asked, then OLDEST first — a single request
 * still gets made, it just queues behind one three people want,
 * and nothing quietly sinks to the bottom by being old.
 */
export function byDemand(requests) {
  const live = requests.filter(r =>
    r.status === REQ_STATUS.OPEN || r.status === REQ_STATUS.PLANNED);

  const groups = new Map();
  for (const r of live) {
    const key = ((r.subject || '') + ' ' + r.chapter)
      .toLowerCase().replace(/\s+/g, ' ').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].sort((a, b) =>
    b.length - a.length || a[0].createdAt - b[0].createdAt);
}
