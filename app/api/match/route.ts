import { NextResponse } from "next/server";
import { getMatcher, matchResultToDict } from "@/lib/matcher";

// Standalone fuzzy-prompt-matcher endpoint — the in-repo replacement for the
// old Python/Flask `GET /api/match?query=...` service. Returns the exact same
// JSON shape (snake_case) so it's a drop-in for any external consumer.
//
//   GET /api/match?query=...          -> match result
//   GET /api/match?query=...&debug=1  -> also include the component breakdown
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") ?? "";
  const debug = ["1", "true", "yes"].includes((searchParams.get("debug") ?? "").toLowerCase());

  const result = getMatcher().match(query);
  return NextResponse.json(matchResultToDict(result, debug));
}
