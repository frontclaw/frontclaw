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

    const handleCopy = () => {
      window.navigator.clipboard.writeText(rawCode);
      toast.info('Copied!')
    };

    useEffect(() => {
      if (inline) return;

      getHighlighter().then(async (highlighter) => {
        await loadAssetsFromHighlighter(highlighter, [language]);

        const hast = highlighter.codeToHast(rawCode, {
          lang: language || "plaintext",
          theme: "github-dark",
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
      return <code className={cn(className, "px-4")}>{rawCode}</code>;
    }

    if (!tree) {
      return (
        <pre className="shiki-skeleton relative">
          <Header language={language} onCopyClick={handleCopy} />
          <div className="px-4">
            <code>{rawCode}</code>
          </div>
        </pre>
      );
    }

    return (
      <div className="relative">
        <Header language={language} onCopyClick={handleCopy} />
        <div className="overflow-x-auto">{tree}</div>
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
    <div className="bg-gray-800 w-full flex items-center justify-between sticky top-0 left-0 px-4 py-1">
      <div className="capitalize flex items-center gap-x-2">
        <Code2Icon size={14} /> <span>{language}</span>
      </div>
      <div>
        <button
          className="rounded-full size-7 hover:bg-gray-600 flex items-center justify-center"
          type="button"
          onClick={onCopyClick}
        >
          <CopyIcon size={16} />
        </button>
      </div>
    </div>
  );
};
