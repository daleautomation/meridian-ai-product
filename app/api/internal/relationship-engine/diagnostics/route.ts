import {
  createRelationshipEngineInternalDiagnosticsGetRoute,
  relationshipEngineInternalReadOnlyMethodNotAllowed,
} from "@/lib/relationship-engine/api/internalDiagnostics";

export const GET = createRelationshipEngineInternalDiagnosticsGetRoute("diagnostics");
export const POST = relationshipEngineInternalReadOnlyMethodNotAllowed;
export const PUT = relationshipEngineInternalReadOnlyMethodNotAllowed;
export const PATCH = relationshipEngineInternalReadOnlyMethodNotAllowed;
export const DELETE = relationshipEngineInternalReadOnlyMethodNotAllowed;
