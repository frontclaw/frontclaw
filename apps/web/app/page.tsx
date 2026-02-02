"use client";

import { CodeBlock } from "@/components/codeblock";
import { FeatureCard } from "@/components/feature-card";
import { Footer } from "@/components/footer";
import { GlowingOrb } from "@/components/glowingorb";
import { Navbar } from "@/components/navbar";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Brain,
  CheckCircle2,
  Code2,
  Cpu,
  GitBranch,
  Layers,
  Terminal,
  Zap,
} from "lucide-react";

export default function FrontclawLanding() {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -50]);

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex justify-center items-start p-2 md:p-6 lg:p-12 selection:bg-cyan-500/30">
      {/* Background Ambience (Behind the Box) */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <GlowingOrb
          color="#0891b2"
          delay={0}
          className="top-[-10%] left-[-10%] w-[500px] h-[500px]"
        />
        <GlowingOrb
          color="#7c3aed"
          delay={2}
          className="bottom-[-10%] right-[-10%] w-[600px] h-[600px]"
        />
        <GlowingOrb
          color="#db2777"
          delay={4}
          className="top-[40%] left-[30%] w-[300px] h-[300px]"
        />
      </div>

      {/* Main "Boxed" Container */}
      <main className="relative z-10 w-full max-w-[1400px] bg-black/40 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden">
        <Navbar />

        {/* Hero Section */}
        <section className="relative px-6 py-20 md:py-32 flex flex-col items-center text-center overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/30 border border-cyan-500/30 text-cyan-400 text-xs font-semibold tracking-wide uppercase mb-8"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            Coming Soon
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/50"
          >
            Predict Intent.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
              Deliver Relevance.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="max-w-2xl text-lg md:text-xl text-zinc-400 mb-10 leading-relaxed"
          >
            A high-performance recommendation engine built on vector embeddings
            and hybrid ranking. Ingest data, train models, and personalize
            experiences in milliseconds.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 w-full justify-center"
          >
            <button className="group relative px-8 py-4 rounded-full bg-white text-black font-semibold flex items-center justify-center gap-2 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-200 to-purple-200 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative">Start Integration</span>
              <ArrowRight className="w-4 h-4 relative transition-transform group-hover:translate-x-1" />
            </button>
            <button className="px-8 py-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold backdrop-blur-sm transition-all flex items-center justify-center gap-2">
              <Terminal className="w-4 h-4" />
              View Documentation
            </button>
          </motion.div>
        </section>

        {/* Floating Interface Preview */}
        <section className="px-6 pb-24 relative z-20">
          <motion.div
            style={{ y }}
            className="max-w-5xl mx-auto rounded-xl p-1 bg-gradient-to-b from-white/10 to-transparent"
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-8 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 overflow-hidden">
              <div className="p-8 md:p-12 border-b lg:border-b-0 lg:border-r border-white/10 flex flex-col justify-center">
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-green-500/10 text-green-400 mt-1">
                      <CheckCircle2 size={20} />
                    </div>
                    <div>
                      <h4 className="text-white font-medium">Auto-Ingestion</h4>
                      <p className="text-zinc-500 text-sm mt-1">
                        Streaming ingestion for items and interactions via API.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 mt-1">
                      <GitBranch size={20} />
                    </div>
                    <div>
                      <h4 className="text-white font-medium">Hybrid Ranking</h4>
                      <p className="text-zinc-500 text-sm mt-1">
                        Combines collaborative filtering with vector semantics.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 mt-1">
                      <Activity size={20} />
                    </div>
                    <div>
                      <h4 className="text-white font-medium">
                        Real-time Learning
                      </h4>
                      <p className="text-zinc-500 text-sm mt-1">
                        RL loops update weights based on live feedback.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-[#0D0D0D] p-6 flex items-center">
                <CodeBlock />
              </div>
            </div>
          </motion.div>
        </section>

        {/* Features Grid */}
        <section
          id="features"
          className="px-6 py-24 bg-white/[0.02] border-t border-white/5"
        >
          <div className="max-w-6xl mx-auto">
            <div className="mb-16 md:text-center max-w-2xl mx-auto">
              <h2 className="text-3xl font-bold text-white mb-4">
                Core Architecture
              </h2>
              <p className="text-zinc-400">
                Built on a modern stack using Redis, Vector Databases, and LLMs
                to ensure your recommendations are diverse, novel, and highly
                accurate.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FeatureCard
                icon={Cpu}
                title="Vector Intelligence"
                description="Uses OpenAI or Cohere embeddings stored in Pinecone/Qdrant to understand semantic similarity beyond keywords."
                delay={0.1}
              />
              <FeatureCard
                icon={Zap}
                title="Millisecond Latency"
                description="Redis caching and optimized Go/Rust microservices ensure API responses in under 50ms at scale."
                delay={0.2}
              />
              <FeatureCard
                icon={Layers}
                title="Smart Profiles"
                description="Dynamic user profiling that balances diversity, novelty, and popularity weights in real-time."
                delay={0.3}
              />
              <FeatureCard
                icon={Code2}
                title="Developer First"
                description="Clean, typed APIs for Ingestion, Recommendation, and Feedback loops. Ready for TS, Python, and Go."
                delay={0.4}
              />
              <FeatureCard
                icon={Brain}
                title="LLM Enhanced"
                description="Use Large Language Models to generate explanations for why a specific item was recommended."
                delay={0.5}
              />
              <FeatureCard
                icon={Activity}
                title="A/B Testing Native"
                description="Built-in experimentation framework to test ranking strategies and algorithms on live traffic."
                delay={0.6}
              />
            </div>
          </div>
        </section>

        {/* Interactive Data Flow Section */}
        <section className="px-6 py-24 border-t border-white/5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />
          <div className="max-w-5xl mx-auto relative z-10">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-white">
                The frontclaw Loop
              </h2>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-4 text-center md:text-left">
              {/* Step 1 */}
              <div className="bg-black/40 backdrop-blur border border-white/10 p-6 rounded-2xl w-full md:w-1/3 relative group hover:border-cyan-500/50 transition-colors">
                <div className="absolute -top-3 -right-3 w-8 h-8 bg-cyan-600 rounded-full flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  Ingest
                </h3>
                <p className="text-sm text-zinc-400">
                  Stream interactions and item metadata via the Ingestion API.
                </p>
              </div>

              <ArrowRight className="hidden md:block text-zinc-600 w-8 h-8" />
              <div className="md:hidden w-px h-8 bg-zinc-700" />

              {/* Step 2 */}
              <div className="bg-black/40 backdrop-blur border border-white/10 p-6 rounded-2xl w-full md:w-1/3 relative group hover:border-purple-500/50 transition-colors">
                <div className="absolute -top-3 -right-3 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  Compute
                </h3>
                <p className="text-sm text-zinc-400">
                  Generate embeddings & rank candidates using hybrid strategies.
                </p>
              </div>

              <ArrowRight className="hidden md:block text-zinc-600 w-8 h-8" />
              <div className="md:hidden w-px h-8 bg-zinc-700" />

              {/* Step 3 */}
              <div className="bg-black/40 backdrop-blur border border-white/10 p-6 rounded-2xl w-full md:w-1/3 relative group hover:border-green-500/50 transition-colors">
                <div className="absolute -top-3 -right-3 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  Refine
                </h3>
                <p className="text-sm text-zinc-400">
                  Capture feedback to update profile weights instantly.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="px-6 py-32 relative overflow-hidden flex flex-col items-center text-center border-t border-white/5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-black to-black pointer-events-none"></div>

          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 relative z-10">
            Ready to personalize?
          </h2>
          <p className="text-zinc-400 max-w-xl mb-10 relative z-10">
            Join high-growth platforms using frontclaw to drive engagement and
            conversion through intelligence.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 relative z-10">
            <button className="px-8 py-3 bg-white text-black font-bold rounded-lg hover:bg-zinc-200 transition-colors">
              Get API Key
            </button>
            <button className="px-8 py-3 bg-transparent border border-white/20 text-white font-medium rounded-lg hover:bg-white/5 transition-colors">
              Contact Sales
            </button>
          </div>
        </section>

        {/* Footer */}
        <Footer />
      </main>
    </div>
  );
}
