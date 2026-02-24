import { getHighlighter, loadAssetsFromHighlighter } from "@/lib/shiki";
import { cn } from "@workspace/ui/lib/utils";
import { Element } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Code2Icon, CopyIcon } from "lucide-react";
import { JSX, memo, ReactNode, useEffect, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { BundledLanguage } from "shiki";
import { toast } from "sonner";

interface CodeHighlightProps {
  className?: string;
  children?: ReactNode;
  node?: Element | undefined;
  inline?: boolean;
}

export const CodeHighlight = memo(
  ({ inline, className, children }: CodeHighlightProps): JSX.Element => {
    const [tree, setTree] = useState<any>(null);

    const match = className?.match(/language-(\w+)/);
    const language = (match ? match[1] : "plaintext") as BundledLanguage;
    const rawCode = String(children).replace(/\n$/, "");

    const handleCopy = (code?: string) => {
      window.navigator.clipboard.writeText(code || rawCode);
      toast.info("Copied!");
    };

    useEffect(() => {
      if (inline) return;

      getHighlighter().then(async (highlighter) => {
        await loadAssetsFromHighlighter(highlighter, [language]);

        const hast = highlighter.codeToHast(rawCode, {
          lang: language || "plaintext",
          theme: "dracula-soft",
        });

        setTree(
          toJsxRuntime(hast, {
            Fragment,
            jsx,
            jsxs,
          }),
        );
      });
    }, [rawCode, language, inline]);

    if (inline) {
      return (
        <code
          className={cn(
            className,
            "p-1 bg-white font-medium rounded border cursor-pointer",
          )}
          onClick={() => {
            handleCopy(rawCode);
          }}
        >
          {rawCode}
        </code>
      );
    }

    if (!tree) {
      return (
        <pre className="shiki-skeleton relative">
          <div className="bg-gray-800/95 backdrop-blur">
            <Header language={language} onCopyClick={handleCopy} />
          </div>
          <div className="px-4 frontui-md-pre">
            <code>{rawCode}</code>
          </div>
        </pre>
      );
    }

    return (
      <div className="frontui-md-pre">
        <div className="bg-gray-800/95 backdrop-blur">
          <Header language={language} onCopyClick={handleCopy} />
        </div>
        <div>{tree}</div>
      </div>
    );
  },
);

CodeHighlight.displayName = "CodeHighlight";

const Header = ({
  language,
  onCopyClick,
}: {
  language: string;
  onCopyClick: () => void;
}) => {
  return (
    <div className="bg-[rgb(40,42,54)] w-full flex items-center justify-between px-4 py-1">
      <div className="capitalize flex items-center gap-x-2">
        <Code2Icon size={14} /> <span>{language}</span>
      </div>
      <div>
        <button
          className="rounded-full size-7 hover:bg-gray-600 flex items-center justify-center"
          type="button"
          onClick={onCopyClick}
        >
          <CopyIcon size={14} />
        </button>
      </div>
    </div>
  );
};
