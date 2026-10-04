// The board fills the viewport; keep the page itself from scrolling.
export default function BoardLayout({ children }: LayoutProps<"/board/[id]">) {
  return <div className="fixed inset-0">{children}</div>;
}
