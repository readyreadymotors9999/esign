import { lazy, Suspense, type ComponentProps } from "react";
import type { Pdf } from "./Pdf";
import { Loading } from "./Loading";
let modulePromise: Promise<typeof import("./Pdf")> | undefined;
function loadViewer() {
  return (modulePromise ??= import("./Pdf").catch((error) => {
    modulePromise = undefined;
    throw error;
  }));
}
export async function prefetchPdfPreview() {
  const module = await loadViewer();
  await module.preparePdfRenderer();
}
const Viewer = lazy(() =>
  loadViewer().then((module) => ({ default: module.Pdf })),
);
export function PdfPreview(props: ComponentProps<typeof Pdf>) {
  return (
    <Suspense fallback={<Loading>Loading PDF…</Loading>}>
      <Viewer {...props} />
    </Suspense>
  );
}
