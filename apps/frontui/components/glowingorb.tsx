import { cn } from "@workspace/ui/lib/utils";
import { motion } from "framer-motion";

export const GlowingOrb = ({
  color,
  delay,
  className,
}: {
  color: string;
  delay: number;
  className?: string;
}) => (
  <motion.div
    className={cn(
      "absolute rounded-full blur-[100px] opacity-40 mix-blend-screen pointer-events-none",
      className,
    )}
    style={{ background: color }}
    animate={{
      scale: [1, 1.2, 1],
      opacity: [0.3, 0.5, 0.3],
      x: [0, 50, -50, 0],
      y: [0, -30, 30, 0],
    }}
    transition={{
      duration: 10,
      repeat: Infinity,
      delay: delay,
      ease: "easeInOut",
    }}
  />
);
