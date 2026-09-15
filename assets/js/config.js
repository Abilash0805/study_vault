// ═══════════════════════════════════════════════════════════
//  StudyVault — configuration
//  The only file you normally need to edit.
// ═══════════════════════════════════════════════════════════

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDrv15WIw8EE-JcUEJuBHFr4zhg5Z51YUg",
  authDomain: "study-vault-85.firebaseapp.com",
  projectId: "study-vault-85",
  storageBucket: "study-vault-85.firebasestorage.app",
  messagingSenderId: "722431627843",
  appId: "1:722431627843:web:d84774eb1a844277743af6"
};

// The admin account. This is mirrored in firestore.rules — changing it here
// alone does NOT grant admin rights, because every privileged write is
// enforced server-side. Update both, then redeploy the rules.
export const ADMIN_EMAIL = "abi.abilashv0805@gmail.com";

export const SITE_NAME = "StudyVault";
