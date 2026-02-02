"use client";

export const CodeBlock = () => {
  return (
    <div className="w-full rounded-xl overflow-hidden bg-[#0D0D0D] border border-white/10 shadow-2xl font-mono text-xs md:text-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/5">
        <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
        <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
        <span className="ml-2 text-zinc-500">recommendation-api.ts</span>
      </div>
      <div className="p-6 text-zinc-300 overflow-x-auto">
        <div className="flex flex-col gap-1">
          <p>
            <span className="text-purple-400">const</span> response{" "}
            <span className="text-cyan-400">=</span>{" "}
            <span className="text-purple-400">await</span> frontclaw.
            <span className="text-blue-400">recommend</span>({"{"}
          </p>
          <p className="pl-4">
            profile_id: <span className="text-green-400">"user_123_abc"</span>,
          </p>
          <p className="pl-4">context: {"{"}</p>
          <p className="pl-8">
            device: <span className="text-green-400">"mobile"</span>,
          </p>
          <p className="pl-8">
            location: <span className="text-green-400">"New York"</span>
          </p>
          <p className="pl-4">{"}"},</p>
          <p className="pl-4">
            strategy: <span className="text-green-400">"hybrid-v2"</span>
          </p>
          <p>{"}"});</p>
          <br />
          <p className="text-zinc-500">// Result: &lt; 45ms latency</p>
          <p>
            <span className="text-purple-400">console</span>.
            <span className="text-blue-400">log</span>(response.items);
          </p>
        </div>
      </div>
    </div>
  );
};
