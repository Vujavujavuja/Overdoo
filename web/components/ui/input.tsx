"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  value: string;
  className?: string;
}

const containerVariants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04 } },
};

const letterVariants = {
  initial: { y: 0, opacity: 0.45 },
  animate: {
    y: "-165%",
    opacity: 0.35,
    transition: { type: "spring" as const, stiffness: 300, damping: 20 },
  },
};

export const Input = ({ label, className = "", value, ...props }: InputProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const showLabel = isFocused || value.length > 0;

  return (
    <div className={cn("relative pt-7", className)}>
      <motion.div
        // motion's `y` replaces the element transform, so the label is anchored
        // from the top rather than centred — otherwise it lands on the text.
        className="pointer-events-none absolute top-7 left-0 text-black"
        variants={containerVariants}
        initial="initial"
        animate={showLabel ? "animate" : "initial"}
      >
        {label.split("").map((char, index) => (
          <motion.span
            key={index}
            className="inline-block text-base"
            variants={letterVariants}
            style={{ willChange: "transform" }}
          >
            {char === " " ? " " : char}
          </motion.span>
        ))}
      </motion.div>

      <input
        type="text"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        {...props}
        className="w-full border-b border-black/25 bg-transparent py-2 text-base text-black outline-none placeholder-transparent focus:border-black"
      />
    </div>
  );
};
