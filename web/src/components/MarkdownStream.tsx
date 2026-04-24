'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const components: Components = {
  h1: (p) => <h3 style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px' }} {...p} />,
  h2: (p) => <h4 style={{ fontSize: 15, fontWeight: 700, margin: '6px 0 4px' }} {...p} />,
  h3: (p) => <h5 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 4px' }} {...p} />,
  p: (p) => <p style={{ margin: '4px 0', lineHeight: 1.55 }} {...p} />,
  ul: (p) => <ul style={{ margin: '4px 0 4px 20px', padding: 0 }} {...p} />,
  ol: (p) => <ol style={{ margin: '4px 0 4px 20px', padding: 0 }} {...p} />,
  li: (p) => <li style={{ margin: '2px 0' }} {...p} />,
  table: (p) => (
    <table
      style={{
        borderCollapse: 'collapse',
        margin: '6px 0',
        fontSize: 13,
      }}
      {...p}
    />
  ),
  th: (p) => (
    <th
      style={{
        border: '1px solid #d5dbdb',
        padding: '4px 8px',
        background: '#f2f3f3',
        textAlign: 'left',
      }}
      {...p}
    />
  ),
  td: (p) => (
    <td style={{ border: '1px solid #d5dbdb', padding: '4px 8px' }} {...p} />
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className || '');
    if (isBlock) {
      return (
        <pre
          style={{
            background: '#272b33',
            color: '#f8f8f2',
            padding: '10px 12px',
            borderRadius: 6,
            overflowX: 'auto',
            fontSize: 12.5,
            lineHeight: 1.5,
            margin: '6px 0',
          }}
        >
          <code {...rest}>{children}</code>
        </pre>
      );
    }
    return (
      <code
        style={{
          background: '#eef1f3',
          padding: '1px 5px',
          borderRadius: 4,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
        {...rest}
      >
        {children}
      </code>
    );
  },
  strong: (p) => <strong style={{ fontWeight: 700 }} {...p} />,
};

export default function MarkdownStream({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 14 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
