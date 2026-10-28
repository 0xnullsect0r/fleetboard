import type { Metadata } from "next";
import { FirstRunForm } from "./FirstRunForm";

export const metadata: Metadata = { title: "FLEETBOARD · FIRST RUN" };

export default function FirstRunPage() {
  return <FirstRunForm />;
}
