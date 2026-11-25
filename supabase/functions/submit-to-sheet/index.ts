import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Prefer a Supabase secret in production; this is the Apps Script endpoint supplied for this tracker.
const sheetWebhook = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "https://script.google.com/macros/s/AKfycbyfo5eLRODYT8f1GL2RraEixzy54XthMKi9ZGNU0w2KCcmeDYzPe0u2yz7jGoZIIeAD/exec";

const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
function recordToTrackerRow(record: Record<string, unknown>): string[] {
  return [
    text(record.entry_date),
    text(record.vc_name),
    text(record.ic_number),
    text(record.recorded_date),
    text(record.recorded_time),
    text(record.mcap_files),
    text(record.duration),
    text(record.status) === "pending" ? text(record.video_status) : text(record.status),
    text(record.city),
    text(record.project_ic_name),
    text(record.ic_name),
    text(record.fo_name),
    text(record.sd_card_count),
    text(record.sd_card_duration),
    text(record.drive_link),
    text(record.vc_comment) || text(record.comment),
    text(record.ic_comment),
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });

  try {
    const { recordId } = await req.json();
    if (typeof recordId !== "string" || !recordId) return new Response(JSON.stringify({ error: "recordId is required" }), { status: 400, headers });
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is missing.");
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: record, error: fetchError } = await supabase.from("sd_card_records").select("*").eq("id", recordId).maybeSingle();
    if (fetchError) throw fetchError;
    if (!record) return new Response(JSON.stringify({ error: "Record not found" }), { status: 404, headers });

    const values = recordToTrackerRow(record as Record<string, unknown>);
    const payload = { values: [values], record: Object.fromEntries(values.map((value, index) => [
      ["entry_date", "vc_name", "ic_number", "recorded_date", "recorded_time", "mcap_files", "duration", "video_status", "city", "project", "ic_name", "fo_name", "sd_card_count", "sd_card_duration", "drive_link", "vc_comment", "ic_comment"][index], value,
    ])) };
    const { data: submission, error: submissionError } = await supabase.from("sheet_submissions").insert({ record_id: recordId, payload, sheet_status: "pending", attempts: 0 }).select("id").maybeSingle();
    if (submissionError) throw submissionError;

    if (!sheetWebhook) return new Response(JSON.stringify({ success: true, sheetPushed: false, message: "Submission saved, but the productivity tracker webhook is not configured.", submissionId: submission?.id }), { headers });
    const sheetResponse = await fetch(sheetWebhook, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
    const sheetText = await sheetResponse.text();
    if (!sheetResponse.ok) {
      await supabase.from("sheet_submissions").update({ sheet_status: "failed", sheet_response: sheetText.slice(0, 1000), attempts: 1 }).eq("id", submission?.id);
      return new Response(JSON.stringify({ success: true, sheetPushed: false, message: "Submission was saved, but Google Sheets rejected the update.", sheetError: sheetText.slice(0, 300) }), { headers });
    }
    await supabase.from("sheet_submissions").update({ sheet_status: "pushed", sheet_response: sheetText.slice(0, 1000), attempts: 1 }).eq("id", submission?.id);
    await supabase.from("sd_card_records").update({ submitted: true }).eq("id", recordId);
    return new Response(JSON.stringify({ success: true, sheetPushed: true, message: "Record submitted to the productivity tracker.", row: values }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), { status: 500, headers });
  }
});
