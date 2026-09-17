import { createHackObservationHandler } from "@/lib/hack/durable-observation";
export const maxDuration = 30;
export const GET = createHackObservationHandler(true);
