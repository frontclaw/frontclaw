import Image from "next/image";

export const Footer = () => {
  return (
    <footer className="px-8 py-12 border-t border-white/10 bg-black/40 text-sm">
      <div className="flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-2">
          <Image src={"/logo.png"} alt="Logo" width={50} height={50} />
          <span className="font-bold text-zinc-300">frontclaw</span>
        </div>
        <div className="flex gap-6 text-zinc-500">
          <a href="#" className="hover:text-white transition-colors">
            Privacy
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Terms
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Twitter
          </a>
          <a href="#" className="hover:text-white transition-colors">
            GitHub
          </a>
        </div>
        <div className="text-zinc-600">© 2026 frontclaw.</div>
      </div>
    </footer>
  );
};
