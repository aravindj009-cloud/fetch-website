const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  "https://skfxzagxlxputwpwxwbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

function clean(value) {
  return String(value ?? "").trim();
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_SECRET_KEY is missing");

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }

  return data;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
}

function workflowStatus(universal, activeTask) {
  const status = clean(universal?.status || universal?.execution?.status || activeTask?.status).toLowerCase();

  if ([
    "completed",
    "order_placed",
    "delivered"
  ].includes(status)) return "completed";

  if ([
    "awaiting_customer_price_confirmation",
    "awaiting_checkout_confirmation",
    "awaiting_product_selection",
    "provider_connection_required",
    "awaiting_location",
    "needs_clarification"
  ].includes(status)) return "waiting";

  if ([
    "partner_offered",
    "finding_shopper",
    "shopper_assigned",
    "shopping",
    "picked_up",
    "out_for_delivery",
    "provider_ready"
  ].includes(status)) return "running";

  return "ready";
}

function stepStatus(index, currentIndex, finalConfirmationRequired, workflowState) {
  if (workflowState === "completed") return "completed";
  if (index < currentIndex) return "completed";
  if (index === currentIndex) {
    return finalConfirmationRequired ? "waiting_confirmation" : "running";
  }
  return "blocked";
}

function deriveCurrentStep({ eventType, state, planLength, existingIndex = 0 }) {
  if (!planLength) return 0;

  if (state === "completed") return Math.max(0, planLength - 1);

  switch (clean(eventType)) {
    case "request_received":
      return 0;
    case "partner_store_offered":
      return Math.min(3, planLength - 1);
    case "shopper_fallback":
      return Math.min(2, planLength - 1);
    default:
      break;
  }

  if ([
    "awaiting_customer_price_confirmation",
    "awaiting_checkout_confirmation",
    "awaiting_product_selection"
  ].includes(clean(state))) {
    return Math.min(Math.max(0, planLength - 1), 5);
  }

  return Math.min(Math.max(0, Number(existingIndex || 0)), planLength - 1);
}

export async function persistFetchWorkflow({
  customerId = null,
  conversationId = null,
  channel = "web",
  sourceText,
  universal,
  activeTask = null,
  orderId = null,
  eventType = "workflow_snapshot"
} = {}) {
  const text = clean(sourceText);
  const decision = universal?.fetch?.decisions?.[0] || {};
  const intent = decision?.intent || {};
  const entities = decision?.entities || {};
  const plan = Array.isArray(decision?.plan) ? decision.plan : [];
  const state = workflowStatus(universal, activeTask);
  const requestedOrderId = clean(orderId || universal?.order_id || universal?.orderId || activeTask?.orderId) || null;
  const activeWorkflowId = isUuid(activeTask?.workflowId) ? activeTask.workflowId : null;

  if (!text && !activeWorkflowId) return null;

  try {
    let workflow = null;

    if (activeWorkflowId) {
      const rows = await supabaseRequest(
        `fetch_workflows?id=eq.${encodeURIComponent(activeWorkflowId)}&select=*&limit=1`
      );
      workflow = Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    if (!workflow && clean(conversationId)) {
      const activeRows = await supabaseRequest(
        `fetch_workflows?conversation_id=eq.${encodeURIComponent(conversationId)}&status=neq.completed&select=*&order=updated_at.desc&limit=1`
      );
      workflow = Array.isArray(activeRows) && activeRows.length ? activeRows[0] : null;
    }

    if (!workflow) {
      const payload = {
        customer_id: clean(customerId) || null,
        conversation_id: clean(conversationId) || null,
        source_channel: clean(channel) || "web",
        source_text: text,
        objective: clean(activeTask?.objective) || text || "Fetch task",
        status: state,
        plan: {
          version: "v1",
          intent,
          entities,
          steps: plan,
          execution: universal?.execution || null,
          provider: universal?.provider || null,
          atc: universal?.atc || null
        },
        current_step_index: 0,
        confirmation_status:
          universal?.execution?.confirmation_required || state === "waiting"
            ? "pending"
            : "not_required",
        metadata: {
          workflow_source: "fetch_agent",
          order_id: requestedOrderId,
          universal_workflow_id: universal?.workflow_id || null
        }
      };

      const created = await supabaseRequest("fetch_workflows", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload)
      });
      workflow = Array.isArray(created) ? created[0] : created;

      if (workflow?.id) {
        const steps = plan.map((purpose, index) => ({
          workflow_id: workflow.id,
          step_index: index,
          step_key: `step_${index + 1}`,
          purpose: clean(purpose),
          domain: clean(intent.domain) || null,
          action: clean(intent.action) || null,
          depends_on: index > 0 ? [`step_${index}`] : [],
          status: stepStatus(
            index,
            0,
            !!universal?.execution?.confirmation_required,
            state
          ),
          input: {
            text,
            entities
          },
          output: {},
          decision: {},
          confirmation_required:
            index === plan.length - 1 && !!universal?.execution?.confirmation_required,
          confirmation_status:
            index === plan.length - 1 && !!universal?.execution?.confirmation_required
              ? "pending"
              : "not_required",
          idempotency_key: requestedOrderId
            ? `fetch:${workflow.id}:order:${requestedOrderId}`
            : `fetch:${workflow.id}:step:${index}`
        }));

        if (steps.length) {
          await supabaseRequest("fetch_workflow_steps", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(steps)
          });
        }
      }
    } else {
      const storedPlan = Array.isArray(workflow?.plan?.steps)
        ? workflow.plan.steps
        : plan;
      const stepCount = storedPlan.length || plan.length;
      const nextStep = deriveCurrentStep({
        eventType,
        state: universal?.status || universal?.execution?.status || state,
        planLength: stepCount,
        existingIndex: workflow.current_step_index
      });

      const metadata = {
        ...(workflow.metadata || {}),
        order_id: requestedOrderId || workflow.metadata?.order_id || null,
        universal_workflow_id:
          universal?.workflow_id || workflow.metadata?.universal_workflow_id || null,
        last_status: universal?.status || universal?.execution?.status || null
      };

      const updatedRows = await supabaseRequest(
        `fetch_workflows?id=eq.${encodeURIComponent(workflow.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: state,
            objective: clean(activeTask?.objective) || workflow.objective || text,
            current_step_index: nextStep,
            confirmation_status:
              universal?.execution?.confirmation_required || state === "waiting"
                ? "pending"
                : state === "completed"
                  ? "approved"
                  : workflow.confirmation_status || "not_required",
            metadata,
            updated_at: new Date().toISOString(),
            completed_at: state === "completed" ? new Date().toISOString() : null
          })
        }
      );

      workflow = Array.isArray(updatedRows) && updatedRows.length
        ? updatedRows[0]
        : workflow;

      if (workflow?.id) {
        const stepRows = await supabaseRequest(
          `fetch_workflow_steps?workflow_id=eq.${encodeURIComponent(workflow.id)}&select=id,step_index,confirmation_required`
        ).catch(() => []);

        for (const step of Array.isArray(stepRows) ? stepRows : []) {
          const statusForStep =
            state === "completed"
              ? "completed"
              : step.step_index < nextStep
                ? "completed"
                : step.step_index === nextStep
                  ? (
                      step.confirmation_required && state === "waiting"
                        ? "waiting_confirmation"
                        : "running"
                    )
                  : "blocked";

          await supabaseRequest(
            `fetch_workflow_steps?id=eq.${encodeURIComponent(step.id)}`,
            {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({
                status: statusForStep,
                output: step.step_index === nextStep
                  ? {
                      latest_status: universal?.status || universal?.execution?.status || state,
                      event_type: clean(eventType),
                      order_id: requestedOrderId
                    }
                  : undefined,
                completed_at: statusForStep === "completed"
                  ? new Date().toISOString()
                  : null,
                updated_at: new Date().toISOString()
              })
            }
          );
        }
      }
    }

    if (workflow?.id) {
      await supabaseRequest("fetch_workflow_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          workflow_id: workflow.id,
          event_type: clean(eventType) || "workflow_snapshot",
          payload: {
            source_text: text,
            status: universal?.status || universal?.execution?.status || state,
            order_id: requestedOrderId,
            provider: universal?.provider || null,
            atc: universal?.atc || null
          }
        })
      });
    }

    return workflow?.id || null;
  } catch (error) {
    console.error("FETCH WORKFLOW PERSIST ERROR", error);
    return activeWorkflowId || null;
  }
}
