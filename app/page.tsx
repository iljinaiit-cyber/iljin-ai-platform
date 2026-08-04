import type { Metadata } from "next";
import { AgentPortal } from "./AgentPortal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "업무 포털",
  description: "개인과 부서의 업무를 연결하는 Enterprise AI Agent Portal",
};

export default function Home() {
  return <AgentPortal />;
}
