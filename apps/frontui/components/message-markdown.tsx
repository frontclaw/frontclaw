"use client";

import { cn } from "@workspace/ui/lib/utils";
import React from "react";
import ReactMarkdown from "react-markdown";
import ShikiHighlighter from "react-shiki";
import remarkGfm from "remark-gfm";

type MessageMarkdownProps = {
  content: string;
};

export const MessageMarkdown = React.memo(
  ({ content }: MessageMarkdownProps) => {
    return (
      <div className={cn("frontui-markdown max-w-3xl", "max-w-[calc(768px-36px)]")}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="frontui-md-p">{children}</p>,
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="frontui-md-a"
              >
                {children}
              </a>
            ),
            strong: ({ children }) => (
              <strong className="frontui-md-strong">{children}</strong>
            ),
            em: ({ children }) => <em className="frontui-md-em">{children}</em>,
            code: ({ className, children }) => {
              const isBlock = className?.includes("language-");
              const languageMatch = /language-([\w-]+)/.exec(className ?? "");
              const language = languageMatch?.[1] ?? "text";
              const code = String(children).replace(/\n$/, "");
              if (isBlock) {
                return (
                  <div className="">
                    <ShikiHighlighter
                      language={language}
                      theme="poimandres"
                      showLanguage={true}
                      // showLineNumbers
                      className=""
                    >
                      {code}
                    </ShikiHighlighter>
                  </div>
                );
              }
              return <code className="frontui-md-code-inline">{children}</code>;
            },
            pre: ({ children }) => (
              <div className="frontui-md-pre">{children}</div>
            ),
            ul: ({ children }) => <ul className="frontui-md-ul">{children}</ul>,
            ol: ({ children }) => <ol className="frontui-md-ol">{children}</ol>,
            li: ({ children }) => <li className="frontui-md-li">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="frontui-md-blockquote">
                {children}
              </blockquote>
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
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
);

MessageMarkdown.displayName = "MessageMarkdown";
