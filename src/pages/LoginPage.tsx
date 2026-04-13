import { auth } from '../firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export default function LoginPage() {
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface-container p-8 rounded-3xl border border-outline-variant/10 shadow-2xl text-center">
        <div className="mb-8">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
            <span className="material-symbols-outlined text-primary text-4xl">kitchen</span>
          </div>
          <h1 className="font-headline text-3xl font-black text-primary tracking-widest uppercase mb-2">NEON PANTRY</h1>
          <p className="text-on-surface-variant text-sm">Initialize your smart kitchen environment</p>
        </div>

        <button
          onClick={handleLogin}
          className="w-full py-4 bg-primary text-on-primary font-headline font-bold uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 hover:opacity-90 transition-all active:scale-[0.98]"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
          Access System
        </button>

        <div className="mt-8 pt-8 border-t border-outline-variant/10">
          <p className="text-[10px] uppercase tracking-[0.3em] text-on-surface-variant font-bold">Secure Protocol Active</p>
        </div>
      </div>
    </div>
  );
}
