"use client";

import { cn } from "@workspace/ui/lib/utils";
import React from "react";
import ReactMarkdown, { Components } from "react-markdown";
import { rehypeInlineCodeProperty } from "react-shiki/web";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeHighlight } from "./code-highlight";

import "katex/dist/katex.min.css";

type MessageMarkdownProps = {
  content: string;
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeInlineCodeProperty, rehypeKatex];

const markdownComponents = {
  p: ({ children }) => <p className="frontui-md-p">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="frontui-md-a">
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="frontui-md-strong">{children}</strong>
  ),
  em: ({ children }) => <em className="frontui-md-em">{children}</em>,
  code: CodeHighlight,
  pre: ({ children }) => <div className="frontui-md-pre">{children}</div>,
  ul: ({ children }) => <ul className="frontui-md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="frontui-md-ol">{children}</ol>,
  li: ({ children }) => <li className="frontui-md-li">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="frontui-md-blockquote">{children}</blockquote>
  ),
  h1: ({ children }) => <h1 className="frontui-md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="frontui-md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="frontui-md-h3">{children}</h3>,
  hr: () => <hr className="frontui-md-hr" />,
  table: ({ children }) => (
    <div className="frontui-md-table-wrap">
      <table className="frontui-md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="frontui-md-th">{children}</th>,
  td: ({ children }) => <td className="frontui-md-td">{children}</td>,
} satisfies Components;

export const MessageMarkdown = React.memo(
  ({ content }: MessageMarkdownProps) => {
    return (
      <div className={cn("max-w-3xl", "max-w-[calc(768px-36px)]")}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
);

MessageMarkdown.displayName = "MessageMarkdown";
