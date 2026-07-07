import { NextResponse } from "next/server";
import { listHistory } from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const history = await listHistory();
  return NextResponse.json({ history });
}
