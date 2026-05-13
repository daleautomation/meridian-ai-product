import {
  createRelationshipEngineGetRoute,
  relationshipEngineReadOnlyMethodNotAllowed,
} from "@/lib/relationship-engine/api/boundary";

export const GET = createRelationshipEngineGetRoute("workflows");
export const POST = relationshipEngineReadOnlyMethodNotAllowed;
export const PUT = relationshipEngineReadOnlyMethodNotAllowed;
export const PATCH = relationshipEngineReadOnlyMethodNotAllowed;
export const DELETE = relationshipEngineReadOnlyMethodNotAllowed;
