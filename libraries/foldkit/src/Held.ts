import { Effect, type Option, type Ref } from 'effect';
import type { ManagedResource } from 'foldkit';

/**
 * A Managed Resource held for a test, as Foldkit holds one for an application's Commands and Subscriptions: what `held` holds, or nothing while it holds nothing. Foldkit gives no way of its own to run a Subscription's Stream without its runtime, so this reaches into how it keeps a resource, here alone, and its test says so loudly if Foldkit changes how.
 */

/** Runs `effect` with `resource` as `held` holds it. */
export const holding =
  <Value, Service>(
    resource: ManagedResource.ManagedResource<Value, Service>,
    held: Ref.Ref<Option.Option<Value>>,
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Service>> =>
    Effect.provideService(effect, resource._tag, held);
