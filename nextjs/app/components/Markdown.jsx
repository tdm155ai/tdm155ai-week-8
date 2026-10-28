import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { resolveMarkdownHref } from "../../lib/content.mjs";

// A relative image path is a file beside the Markdown (in content/), served by app/context-media/.
function resolveMediaSrc(src, dir) {
  if (typeof src !== "string" || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return src;
  const parts = [...dir.split("/"), ...src.split("/")].filter((part) => part && part !== ".");
  const resolved = [];
  for (const part of parts) part === ".." ? resolved.pop() : resolved.push(part);
  return `/context-media/${resolved.map(encodeURIComponent).join("/")}`;
}

function caption(alt = "") {
  return alt.replace(/^(?:video|audio|youtube)\s*:\s*/i, "").trim();
}

function youtubeEmbed(src) {
  try {
    const url = new URL(src);
    if (url.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    if (url.hostname.endsWith("youtube.com")) {
      const id = url.searchParams.get("v") || url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

function Media({ src, alt = "" }) {
  if (typeof src !== "string") return null;
  const label = caption(alt);
  const youtube = youtubeEmbed(src);
  const video = /^video\s*:/i.test(alt) || /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(src);
  const audio = /^audio\s*:/i.test(alt) || /\.(?:mp3|m4a|wav|ogg)(?:[?#]|$)/i.test(src);

  if (youtube || (/^youtube\s*:/i.test(alt) && youtube)) {
    return (
      <span className="media-embed video-embed">
        <span className="video-ratio"><iframe src={youtube} title={label || "Embedded video"} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></span>
        {label && <span className="media-caption">{label}</span>}
      </span>
    );
  }
  if (video) {
    return (
      <span className="media-embed">
        <video src={src} controls playsInline preload="metadata">Your browser does not support embedded video.</video>
        {label && <span className="media-caption">{label}</span>}
      </span>
    );
  }
  if (audio) {
    return (
      <span className="media-embed audio-embed">
        <audio src={src} controls preload="metadata">Your browser does not support embedded audio.</audio>
        {label && <span className="media-caption">{label}</span>}
      </span>
    );
  }
  return (
    <span className="media-embed">
      <img src={src} alt={alt} loading="lazy" />
      {alt && <span className="media-caption">{alt}</span>}
    </span>
  );
}

// `print`: links print as their text (the address follows in parentheses for outside links), and players as their address.
export default function Markdown({ doc, print = false }) {
  const dir = doc.dir || "";
  const body = doc.content.replace(/^\s*#\s+[^\n]+(?:\r?\n|$)/, "");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      components={{
        a: ({ href, children }) => {
          // A relative link to a file beside the document (a PDF, an image) opens the file itself.
          const file = typeof href === "string" && /\.(?:pdf|png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(href);
          const resolved = file ? resolveMediaSrc(href, dir) : resolveMarkdownHref(href, dir);
          const external = /^https?:\/\//i.test(resolved);
          if (print) return <a href={resolved}>{children}{external && typeof children === "string" && children !== resolved ? <span className="print-url"> ({resolved})</span> : null}</a>;
          return <a href={resolved} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{children}</a>;
        },
        img: ({ src, alt }) => {
          const resolved = resolveMediaSrc(src, dir);
          if (print && typeof resolved === "string" && (youtubeEmbed(resolved) || /\.(?:mp4|webm|mov|m4v|mp3|m4a|wav|ogg)(?:[?#]|$)/i.test(resolved))) {
            return <span className="print-url">{caption(alt) || "Media"}: {resolved}</span>;
          }
          return <Media src={resolved} alt={alt} />;
        },
        p: ({ node, children }) => node?.children?.length === 1 && node.children[0]?.tagName === "img" ? <div className="media-paragraph">{children}</div> : <p>{children}</p>,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
