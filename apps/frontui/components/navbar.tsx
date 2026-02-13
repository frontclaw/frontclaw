import Image from "next/image";

export const Navbar = () => (
  <nav className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-50">
    <div className="flex items-center gap-2">
      <Image src={"/logo.png"} alt="Logo" width={50} height={50} />
      <span className="text-xl font-bold tracking-tight text-white">
        frontclaw
      </span>
    </div>
    <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
      <a href="#features" className="hover:text-cyan-400 transition-colors">
        Capabilities
      </a>
      <a href="#architecture" className="hover:text-cyan-400 transition-colors">
        Architecture
      </a>
      <a href="#api" className="hover:text-cyan-400 transition-colors">
        API
      </a>
    </div>
    <div className="flex gap-4">
      <button className="text-zinc-300 hover:text-white text-sm font-medium transition-colors">
        Log in
      </button>
      <button className="bg-white/10 hover:bg-white/20 border border-white/10 text-white px-4 py-2 rounded-full text-sm font-medium transition-all backdrop-blur-sm">
        Get Started
      </button>
    </div>
  </nav>
);
