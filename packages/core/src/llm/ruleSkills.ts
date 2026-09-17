/**
 * Per-rule fix guidance — the "skill" a generic fix-writing model doesn't
 * have on its own. FIX_SYSTEM_PROMPT_BASE (AnthropicProvider.ts) is deliberately
 * generic ("senior software engineer, output a diff"); this file is where
 * rule-specific expertise (which API to batch through, which idiom to
 * prefer per framework) lives, keyed by CodeFinding.ruleId and appended to
 * the system prompt only for the rule actually being fixed. Adding a new
 * rule's guidance here doesn't require touching AnthropicProvider.ts.
 */
export const RULE_FIX_GUIDANCE: Record<string, string> = {
  "n-plus-one-query": `This is an N+1 query loop: a single query call runs once per loop iteration
instead of once total. Batch it — for Django, replace \`Model.objects.get(...)\` inside the loop with a
single \`Model.objects.filter(id__in=[...])\` before the loop, then look up by id from an in-memory dict.
For Spring Data JPA, replace \`repo.findById(...)\`/\`repo.getOne(...)\` inside the loop with a single
\`repo.findAllById(...)\` call, or a \`JOIN FETCH\` JPQL query if the loop also touches a related entity.
Do not just add caching — the fix must reduce the query count to O(1), not just avoid repeat identical queries.`,

  "unbounded-query": `A zero-argument \`.objects.all()\` / \`repo.findAll()\` call fetches every row into
memory in one response. Fix by adding pagination: for Django, use \`Paginator\` or slice the queryset
(\`[offset:offset+limit]\`) with a bounded page size; for Spring Data JPA, change the method signature to
accept a \`Pageable\` and return \`Page<T>\`/\`Slice<T>\`. Preserve the existing return type's call sites as
much as possible — if pagination can't be added without changing the caller's contract, prefer a bounded
derived query (e.g. \`.filter(...)[:1000]\`) over leaving it fully unbounded.`,

  "chatty-s3-loop": `A loop issues one S3 API call (getObject/putObject/listObjects/headObject) per
iteration. Batch it: for a listing loop, call \`list_objects_v2\`/\`listObjectsV2\` ONCE outside the loop
and paginate with its own continuation token, rather than calling it per item. For get/put loops over many
keys, prefer the SDK's transfer manager / batch API (boto3's \`S3Transfer\`, or the Java SDK's
\`S3TransferManager\`) instead of one client call per key. If the SDK truly has no batch primitive for this
exact operation, at minimum reuse one client/session across iterations rather than constructing one per call.`,

  "oversized-instance-type": `An EC2 instance type is hardcoded to a large/xlarge size with no evidence
of the actual workload's requirements. Fix by right-sizing the Terraform \`instance_type\` down to the
smallest size that's still a reasonable default for the resource's apparent role (e.g. a \`t3.medium\` or
\`m5.large\` for a generic app server, not \`m5.4xlarge\`) — do not guess at an exotic instance family the
codebase doesn't already use elsewhere. If the resource is behind an Auto Scaling Group, prefer scaling out
via \`desired_capacity\`/\`min_size\` over scaling up the instance size.`,

  "missing-lifecycle-policy": `An S3 bucket resource has no \`lifecycle_rule\` block, so objects
accumulate in storage indefinitely at full cost. Fix by adding a \`lifecycle_rule\` block with a sensible
default: transition to \`STANDARD_IA\` after 30 days and \`GLACIER\` after 90 days (or expire outright if the
bucket's name/context suggests transient data like logs or temp exports) — infer the right retention window
from the bucket's name and any existing tags/comments rather than always defaulting to the same numbers.`,

  "no-autoscaling-floor": `An Auto Scaling Group (or equivalent) has no \`min_size\`/scaling floor,
so it can scale to zero and lose availability, or lacks a policy to scale down at all and just runs at
peak capacity permanently. Fix by adding an explicit \`min_size\` appropriate to the resource's apparent
role (never 0 for something serving live traffic) alongside \`max_size\`, and prefer a
target-tracking/step scaling policy over a fixed \`desired_capacity\` if one isn't already present.`,
};

export function ruleFixGuidance(ruleId: string | undefined): string | undefined {
  return ruleId ? RULE_FIX_GUIDANCE[ruleId] : undefined;
}
