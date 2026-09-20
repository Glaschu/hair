import { BookingCredentials } from '../bookingLink';
import {
  BackendMode, Capability, capabilitiesFor, whyUnavailable, notConnected, degraded, Unavailable,
} from './capabilities';

export * from './capabilities';

/**
 * The one seam between the app and wherever its bookings live.
 *
 * Three implementations behind it — no server, her own server, someone else's —
 * and the app never learns which. It asks what it can do, and does that.
 *
 * Adding a fourth backend must cost one file and no screen changes. If it ever
 * costs more, this interface has grown something mode-shaped and should be cut
 * back.
 */
export interface Backend {
  readonly mode: BackendMode;

  /** Can we do this here? The only question screens should ask. */
  has(capability: Capability): boolean;

  /** Why not, in words she can act on. */
  why(capability: Capability): Unavailable;

  /**
   * Reachable, and speaking a version we understand.
   *
   * Separate from `has` because a capability can exist and still be down, and
   * those two states need different things said about them.
   */
  health(): Promise<{ ok: boolean; apiVersion?: number; message?: string }>;
}

/** Nothing but this device. Her today, and anyone who wants no server at all. */
export class LocalBackend implements Backend {
  readonly mode = 'in-app' as const;
  private readonly caps = capabilitiesFor('in-app');

  has(capability: Capability): boolean { return this.caps.has(capability); }
  why(capability: Capability): Unavailable { return whyUnavailable(capability); }

  // Always fine: there is nothing to be unreachable. The app works on a train.
  async health() { return { ok: true }; }
}

/**
 * A booking service — hers, or one operated for her.
 *
 * The two differ in who holds the keys and who carries the liability, not in
 * what the app can do, so they share everything except `mode` and how the
 * credentials were obtained.
 */
export class ServiceBackend implements Backend {
  readonly mode: BackendMode;
  private readonly allowed: ReadonlySet<Capability>;
  /** What the service said it can do. Null until we have asked. */
  private reported: ReadonlySet<Capability> | null = null;

  constructor(
    readonly credentials: BookingCredentials,
    mode: 'self-hosted' | 'hosted' = 'self-hosted',
    private readonly probe?: (creds: BookingCredentials) =>
      Promise<{ apiVersion: number; capabilities?: string[] }>,
  ) {
    this.mode = mode;
    this.allowed = capabilitiesFor(mode);
  }

  /**
   * The intersection of what this kind of deployment may do and what this
   * particular one says it can.
   *
   * Two services running identical code differ by which secrets their owner set
   * — a stylist who has not connected her Stripe account has a perfectly good
   * booking service that cannot take deposits. Assuming otherwise means
   * offering her a button that fails.
   *
   * Before the service has answered we go on the mode alone, so the app is
   * useful on first paint rather than blank until the network returns.
   */
  has(capability: Capability): boolean {
    if (!this.allowed.has(capability)) return false;
    return this.reported ? this.reported.has(capability) : true;
  }

  why(capability: Capability): Unavailable {
    // A capability the mode allows but the service does not report is a
    // different problem with a different answer: something to connect, not
    // something to set up.
    if (this.allowed.has(capability) && this.reported && !this.reported.has(capability)) {
      return notConnected(capability);
    }
    return whyUnavailable(capability);
  }

  async health() {
    if (!this.probe) return { ok: true };
    try {
      const { apiVersion, capabilities } = await this.probe(this.credentials);
      if (capabilities) {
        this.reported = new Set(
          capabilities.filter((c): c is Capability => this.allowed.has(c as Capability)),
        );
      }
      return { ok: true, apiVersion };
    } catch (e) {
      // Unreachable is not the same as unsupported, and the app says so
      // differently: nothing here is lost, it is just not arriving yet. The
      // last-reported capabilities are deliberately kept — a service that is
      // down still has them.
      return { ok: false, message: e instanceof Error ? e.message : 'unreachable' };
    }
  }
}

/**
 * Which backend this device is running.
 *
 * Credentials are the whole signal — no setting to get out of step with
 * reality, and no way to be in "hosted mode" with nothing to talk to.
 */
export function backendFor(
  credentials: BookingCredentials | null,
  opts: { mode?: 'self-hosted' | 'hosted'; probe?: (c: BookingCredentials) => Promise<{ apiVersion: number }> } = {},
): Backend {
  if (!credentials) return new LocalBackend();
  return new ServiceBackend(credentials, opts.mode ?? 'self-hosted', opts.probe);
}

export { degraded };
