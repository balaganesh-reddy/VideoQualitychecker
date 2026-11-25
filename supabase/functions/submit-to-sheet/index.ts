import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Configure the actual deployed Apps Script /exec URL as a Supabase secret. Never hardcode it here.
const sheetWebhook = Deno.env.get("GOOGLE_SCRIPT_URL") ?? Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL") ?? "";
const headers = [
  "Entry Date (Date-Month)", "VC name", "IC Number (IC-1)", "Recorded Date (Date-Month)",
  "Recorded Time(00:00:00)HH:MM:SS", "Mcap files", "Duration", "Video Status", "City",
  "Project", "IC name", "FO Name", "SD card count (SD-1)", "SD Card duration", "Drive link",
  "VC comment", "IC comment",
];
const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
function recordToTrackerRow(record: Record<string, unknown>): Record<string, string> {
  const values = [
    text(record.entry_date).slice(0, 10), text(record.vc_name), text(record.ic_number),
    text(record.recorded_date).slice(0, 10), text(record.recorded_time), text(record.mcap_files),
    text(record.duration), text(record.video_status), text(record.city), text(record.project_ic_name),
    text(record.ic_name), text(record.fo_name), text(record.sd_card_count), text(record.sd_card_duration),
    text(record.drive_link), text(record.vc_comment) || text(record.comment), text(record.ic_comment),
  ];
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: responseHeaders });

  try {
    const { recordId } = await req.json();
    if (typeof recordId !== "string" || !recordId) return new Response(JSON.stringify({ error: "recordId is required" }), { status: 400, headers: responseHeaders });
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is missing.");
    if (!sheetWebhook) throw new Error("Google Apps Script URL is not configured. Set the GOOGLE_SCRIPT_URL Supabase function secret.");
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: record, error: fetchError } = await supabase.from("sd_card_records").select("*").eq("id", recordId).maybeSingle();
    if (fetchError) throw fetchError;
    if (!record) return new Response(JSON.stringify({ error: "Inspection record not found." }), { status: 404, headers: responseHeaders });
    if (record.submitted) return new Response(JSON.stringify({ error: "This inspection has already been submitted.", sheetPushed: false }), { status: 409, headers: responseHeaders });
    if (!record.ic_number || !record.ic_name || !record.mcap_files || !record.sd_card_count || record.status === "pending") {
      return new Response(JSON.stringify({ error: "Inspection is incomplete: IC mapping, MCAP file, SD card, and status are required." }), { status: 400, headers: responseHeaders });
    }

    const payload = recordToTrackerRow(record as Record<string, unknown>);
    const { data: submission, error: submissionError } = await supabase.from("sheet_submissions")
      .insert({ record_id: recordId, payload, sheet_status: "pending", attempts: 0 }).select("id").maybeSingle();
    if (submissionError) throw submissionError;

    const sheetResponse = await fetch(sheetWebhook, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload),
    });
    const sheetText = await sheetResponse.text();
    let result: { success?: boolean; message?: string } | null = null;
    try { result = JSON.parse(sheetText); } catch { /* Apps Script must return JSON success for a verified delivery. */ }
    if (!sheetResponse.ok || result?.success !== true) {
      const reason = result?.message || sheetText.slice(0, 500) || `Apps Script returned HTTP ${sheetResponse.status}.`;
      await supabase.from("sheet_submissions").update({ sheet_status: "failed", sheet_response: reason.slice(0, 1000), attempts: 1 }).eq("id", submission?.id);
      return new Response(JSON.stringify({ error: `Google Sheets submission failed: ${reason}`, sheetPushed: false }), { status: 502, headers: responseHeaders });
    }
    await supabase.from("sheet_submissions").update({ sheet_status: "pushed", sheet_response: sheetText.slice(0, 1000), attempts: 1 }).eq("id", submission?.id);
    const { error: markError } = await supabase.from("sd_card_records").update({ submitted: true }).eq("id", recordId).eq("submitted", false);
    if (markError) throw markError;
    return new Response(JSON.stringify({ success: true, sheetPushed: true, message: result.message || "Data saved successfully" }), { headers: responseHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error", sheetPushed: false }), { status: 500, headers: responseHeaders });
  }
});
