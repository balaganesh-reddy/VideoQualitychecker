import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface TrackerRow {
  entry_date: string;
  vc_name: string;
  ic_number: string;
  recorded_date: string;
  recorded_time: string;
  mcap_files: string;
  duration: string;
  video_status: string;
  city: string;
  project: string;
  ic_name: string;
  fo_name: string;
  sd_card_count: string;
  sd_card_duration: string;
  drive_link: string;
  vc_comment: string;
  ic_comment: string;
}

const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);

function buildTrackerRow(record: Record<string, unknown>): TrackerRow {
  return {
    entry_date: text(record.entry_date),
    vc_name: text(record.vc_name),
    ic_number: text(record.ic_number),
    recorded_date: text(record.recorded_date),
    recorded_time: text(record.recorded_time),
    mcap_files: text(record.mcap_files),
    duration: text(record.duration),
    video_status: text(record.status) === "pending" ? text(record.video_status) : text(record.status),
    city: text(record.city),
    project: text(record.project_ic_name),
    ic_name: text(record.ic_name),
    fo_name: text(record.fo_name),
    sd_card_count: text(record.sd_card_count),
    sd_card_duration: text(record.sd_card_duration),
    drive_link: text(record.drive_link),
    vc_comment: text(record.vc_comment) || text(record.comment),
    ic_comment: text(record.ic_comment),
  };
}

function rowValues(row: TrackerRow): string[] {
  return [
    row.entry_date, row.vc_name, row.ic_number, row.recorded_date, row.recorded_time,
    row.mcap_files, row.duration, row.video_status, row.city, row.project, row.ic_name,
    row.fo_name, row.sd_card_count, row.sd_card_duration, row.drive_link,
    row.vc_comment, row.ic_comment,
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }

  try {
    const { recordId } = await req.json();
    if (!recordId || typeof recordId !== "string") {
      return new Response(JSON.stringify({ error: "recordId is required" }), { status: 400, headers: jsonHeaders });
    }
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is missing.");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: record, error: fetchError } = await supabase
      .from("sd_card_records")
      .select("*")
      .eq("id", recordId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!record) return new Response(JSON.stringify({ error: "Record not found" }), { status: 404, headers: jsonHeaders });

    const trackerRow = buildTrackerRow(record as Record<string, unknown>);
    const values = rowValues(trackerRow);
    const payload = { values: [values], record: trackerRow };

    const { data: submission, error: submissionError } = await supabase
      .from("sheet_submissions")
      .insert({ record_id: recordId, payload, sheet_status: "pending", attempts: 0 })
      .select("id")
      .maybeSingle();
    if (submissionError) throw submissionError;

    const webhook = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL");
    if (!webhook) {
      return new Response(JSON.stringify({
        success: true,
        sheetPushed: false,
        message: "Submission saved, but GOOGLE_SHEET_WEBHOOK_URL is not configured in Supabase.",
        submissionId: submission?.id,
      }), { headers: jsonHeaders });
    }

    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    if (!response.ok) {
      await supabase.from("sheet_submissions").update({
        sheet_status: "failed", sheet_response: responseText.slice(0, 1000), attempts: 1,
      }).eq("id", submission?.id);
      return new Response(JSON.stringify({
        success: true,
        sheetPushed: false,
        message: "Submission saved, but Google Sheets rejected the update.",
        sheetError: responseText.slice(0, 300),
      }), { headers: jsonHeaders });
    }

    await supabase.from("sheet_submissions").update({
      sheet_status: "pushed", sheet_response: responseText.slice(0, 1000), attempts: 1,
    }).eq("id", submission?.id);
    await supabase.from("sd_card_records").update({ submitted: true }).eq("id", recordId);
    return new Response(JSON.stringify({
      success: true,
      sheetPushed: true,
      message: "Record submitted to the productivity tracker.",
      row: values,
    }), { headers: jsonHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders });
  }
});
