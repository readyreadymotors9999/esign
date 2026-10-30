import { lazy, Suspense, type ComponentProps } from "react";
import type { Pdf } from "./Pdf";
import { Loading } from "./Loading";
const Viewer = lazy(() =>
  import("./Pdf").then((module) => ({ default: module.Pdf })),
);
export function PdfPreview(props: ComponentProps<typeof Pdf>) {
  return (
    <Suspense fallback={<Loading>Loading PDF…</Loading>}>
      <Viewer {...props} />
    </Suspense>
  );
}
