import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

/**
 * AI 回复的 Markdown 渲染（标题/加粗/表格/列表/代码/引用，深色主题）。
 * 代码块经 rehype-highlight 做语法高亮（github-dark 配色挂全局 CSS，A9）。
 * 图片：应用 CSP 不允许外链图，AI 画线本就落屏到图表；这里用 alt 文字兜底，不显示破图。
 */
export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 外链图被 CSP 拦截：显示 alt 提示（AI 的"图"应通过画线/标注落到图表上）
          img: ({ alt, src }) => (
            <span className="md-img-hint" title={src}>
              🖼 {alt || '图片'}
            </span>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
