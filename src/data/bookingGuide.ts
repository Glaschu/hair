/**
 * How online booking is set up and used, start to finish.
 *
 * One list, shown in Settings on the phone and the iPad. The same steps are
 * written out on the booking site at /guide.html — bookingGuide.test.ts checks
 * the two have not drifted apart, because a guide that disagrees with itself
 * is worse than none.
 *
 * Every name in quotes is the label she will actually see on screen.
 */

export interface GuideStep {
  title: string;
  body: string;
  /** Only shown when it applies; says when that is. */
  note?: string;
}

export interface GuideSection {
  heading: string;
  steps: GuideStep[];
}

export const BOOKING_GUIDE: GuideSection[] = [
  {
    heading: 'Set it up, once',
    steps: [
      {
        title: 'Turn on online booking',
        body: 'In Settings, switch on "Online booking". The rest of the booking settings appear underneath.',
      },
      {
        title: 'Open your setup page',
        body: 'On a computer or another screen, go to your booking site and add /setup to the address. It shows a code.',
      },
      {
        title: 'Link this device',
        body: 'Tap "Set up booking service", then "Scan a code", and point the camera at the code. If the code is on this same device, use "Copy code" on the page and paste it in the app instead.',
      },
      {
        title: 'Sign in and get approved',
        body: 'Enter an email and a password — the first time, this makes your account. The app then shows this device\'s ID. Send it with "Share this ID" to whoever looks after your booking service; once they have approved it, tap "Check again".',
        note: 'Only if the app asks you to sign in. Some booking services skip this step.',
      },
      {
        title: 'Check your cancellation policy',
        body: 'Open "Cancellation policy" and read the wording. Clients agree to it before they book, so make it say what you mean.',
      },
    ],
  },
  {
    heading: 'Day to day',
    steps: [
      {
        title: 'Send a client a link',
        body: 'Open the client\'s card and tap "Send link". Pick the service and the times you want to offer, then send it by message. The link is theirs alone and works once.',
      },
      {
        title: 'Bring bookings into your diary',
        body: 'Pull down on Today. New bookings arrive with the client\'s name and number, and anything a client cancelled online is marked cancelled.',
      },
      {
        title: 'Block your days off',
        body: 'In Settings, open "Days off" and pick the dates. Those days are never offered, and can\'t be booked even from a link you already sent.',
      },
      {
        title: 'Cancel a booking',
        body: 'Open the appointment and tap "Cancel". Your booking page is told too, so the time is free to offer again. If you have no signal, it is sent as soon as you are back.',
      },
    ],
  },
  {
    heading: 'Good to know',
    steps: [
      {
        title: 'Adding your iPad',
        body: 'On the phone that already works, open "Booking service" and tap "Link another device". Scan that code with the iPad. Don\'t use the setup page for a second device.',
      },
      {
        title: 'Taking deposits',
        body: 'Deposits need a Stripe account connected to your booking service. Until that is done, bookings work without them. When it is, clients pay when they book, and cancelling asks you how much to refund.',
      },
      {
        title: 'What stays private',
        body: 'A client\'s name and number are locked on their phone before they are sent, and only your devices can open them. Your booking service never sees who booked.',
      },
    ],
  },
];
