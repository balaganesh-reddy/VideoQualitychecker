import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface RecordRow {
  entry_date: string;
  vc_name: string;
  ic_number: string;
  recorded_date: string;
  recorded_time: string;
  mcap_files: string;
  duration: string;
  video_status: string;
  city: string;
  project_ic_name: string;
  fo_name: string;
  sd_card_count: string;
  sd_card_duration: string;
  status: string;
  comment: string;
}

function buildRecord(record: Record<string, unknown>): RecordRow {
  return {
    entry_date: (record.entry_date as string) ?? "",
    vc_name: (record.vc_name as string) ?? "",
    ic_number: (record.ic_number as string) ?? "",
    recorded_date: (record.recorded_date as string) ?? "",
    recorded_time: (record.recorded_time as string) ?? "",
    mcap_files: (record.mcap_files as string) ?? "",
    duration: (record.duration as string) ?? "",
    video_status: (record.video_status as string) ?? "",
    city: (record.city as string) ?? "",
    project_ic_name: (record.project_ic_name as string) ?? "",
    fo_name: (record.fo_name as string) ?? "",
    sd_card_count: (record.sd_card_count as string) ?? "",
    sd_card_duration: (record.sd_card_duration as string) ?? "",
    status: (record.status as string) ?? "",
    comment: (record.comment as string) ?? "",
  };
}

function recordToArray(r: RecordRow): string[] {
  return [
    r.entry_date, r.vc_name, r.ic_number, r.recorded_date, r.recorded_time,
    r.mcap_files, r.duration, r.video_status, r.city, r.project_ic_name,
    r.fo_name, r.sd_card_count, r.sd_card_duration, r.status, r.comment,
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const recordId = body?.recordId;

    if (!recordId) {
      return new Response(
        JSON.stringify({ error: "recordId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: record, error: fetchError } = await supabase
      .from("sd_card_records")
      .select("*")
      .eq("id", recordId)
      .maybeSingle();

    if (fetchError || !record) {
      return new Response(
        JSON.stringify({ error: "Record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rec = buildRecord(record as Record<string, unknown>);
    const rowArray = recordToArray(rec);
    const payload = { values: [rowArray], record: rec };

    // Always save the submission durably first — data is never lost.
    const { data: submission, error: subError } = await supabase
      .from("sheet_submissions")
      .insert({
        record_id: recordId,
        payload,
        sheet_status: "pending",
        attempts: 0,
      })
      .select()
      .maybeSingle();

    const submissionId = submission?.id;

    const sheetWebhookUrl = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL");

    if (!sheetWebhookUrl) {
      // Mark the record as submitted locally; the submission row stays "pending"
      // so it can be pushed to the sheet later once the webhook is configured.
      await supabase
        .from("sd_card_records")
        .update({ submitted: true })
        .eq("id", recordId);

      return new Response(
        JSON.stringify({
          success: true,
          sheetPushed: false,
          message:
            "Record saved. Google Sheet webhook is not configured — it will be pushed once configured.",
          submissionId,
          row: rowArray,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const jsonBody = JSON.stringify(payload);

    // Try multiple content types — Google Apps Script webhooks vary in what they accept.
    const attempts: { contentType: string; body: string }[] = [
      { contentType: "text/plain;charset=utf-8", body: jsonBody },
      { contentType: "application/json", body: jsonBody },
      {
        contentType: "application/x-www-form-urlencoded",
        body: `data=${encodeURIComponent(jsonBody)}`,
      },
    ];

    let lastError = "";
    let succeeded = false;

    for (const attempt of attempts) {
      try {
        const sheetResponse = await fetch(sheetWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": attempt.contentType },
          body: attempt.body,
        });

        const sheetText = await sheetResponse.text();

        if (sheetResponse.ok) {
          succeeded = true;

          // Update the submission row with success.
          if (submissionId) {
            await supabase
              .from("sheet_submissions")
              .update({
                sheet_status: "pushed",
                sheet_response: sheetText.slice(0, 1000),
                attempts: attempts.indexOf(attempt) + 1,
              })
              .eq("id", submissionId);
          }

          await supabase
            .from("sd_card_records")
            .update({ submitted: true })
            .eq("id", recordId);

          return new Response(
            JSON.stringify({
              success: true,
              sheetPushed: true,
              message: "Record submitted to Google Sheet successfully.",
              submissionId,
              row: rowArray,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // 405 / 403 means the deployment doesn't accept POST — no point retrying.
        if (sheetResponse.status === 405 || sheetResponse.status === 403) {
          lastError = `HTTP ${sheetResponse.status}: ${sheetText.slice(0, 300)}`;
          break;
        }

        lastError = `HTTP ${sheetResponse.status} (${attempt.contentType}): ${sheetText.slice(0, 300)}`;
      } catch (fetchErr) {
        lastError = `Network error (${attempt.contentType}): ${fetchErr.message}`;
      }
    }

    // Sheet push failed — but the submission is saved durably.
    // Mark the record as submitted (validation done) but the submission stays "failed".
    if (submissionId) {
      await supabase
        .from("sheet_submissions")
        .update({
          sheet_status: "failed",
          sheet_response: lastError.slice(0, 1000),
          attempts: 3,
        })
        .eq("id", submissionId);
    }

    await supabase
      .from("sd_card_records")
      .update({ submitted: true })
      .eq("id", recordId);

    return new Response(
      JSON.stringify({
        success: true,
        sheetPushed: false,
        message:
          "Record saved and marked submitted, but the Google Sheet push failed. The data is stored safely and can be retried.",
        sheetError: lastError,
        submissionId,
        row: rowArray,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
