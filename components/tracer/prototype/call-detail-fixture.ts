/**
 * PROTOTYPE - throwaway. A rich Call Detail fixture (a 2:35 plumbing call
 * with a 26-turn Transcript, a Lead Assessment with evidence, a Lead
 * Review, and a full processing timeline) so the variants can be judged at
 * realistic density. Used only with ?demo=1 outside production. The demo
 * media routes synthesize audio and peaks from these turns so the player
 * really plays and the lanes line up with the Transcript.
 */
import type { CallDetail } from "@/data/call-details";
import type { CallNeighbors } from "@/data/calls";
import type { TranscriptTurn } from "@/data/transcript";

export const demoMediaPath = "/api/prototype/recording";
export const demoDurationSeconds = 155;

const startedAt = new Date("2026-10-21T15:04:05.000Z");
const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000).toISOString();

const turn = (speaker: TranscriptTurn["speaker"], start: number, end: number, text: string): TranscriptTurn => ({ speaker, startMs: start * 1000, endMs: end * 1000, text });

export const demoTurns: TranscriptTurn[] = [
  turn("Business", 0.8, 4.2, "Thanks for calling Acme Plumbing, this is Dana. How can I help you today?"),
  turn("Caller", 4.9, 12.5, "Hi Dana. My water heater is leaking from the bottom and there's water all over the garage floor. I need somebody out today if that's possible."),
  turn("Business", 13.0, 17.4, "Oh no, I'm sorry to hear that. Let's get you taken care of. Is the water still coming out right now?"),
  turn("Caller", 17.9, 24.6, "It's a slow drip now. I turned the cold water supply valve off like the manual said, but I didn't touch the gas."),
  turn("Business", 25.0, 31.8, "That was the right call. Leave the gas alone for now. Can I get your name and the address where the heater is?"),
  turn("Caller", 32.2, 38.9, "Sure, it's Marcus Reed. 4471 Juniper Lane in Chandler, the house with the blue garage door."),
  turn("Business", 39.3, 42.1, "Got it, Marcus. And is this the best number to reach you on?"),
  turn("Caller", 42.4, 44.0, "Yes, this is my cell."),
  turn("Business", 44.5, 52.7, "Perfect. Do you know roughly how old the heater is, and is it a tank unit or tankless? A sticker on the side usually has the manufacture date."),
  turn("Caller", 53.2, 61.9, "It's a tank, a 50 gallon Rheem. The sticker says 2013, so it's about thirteen years old. Honestly I figured it was about due."),
  turn("Business", 62.3, 73.5, "Thirteen years is right around the end of its life, so a leak from the bottom of the tank usually means the tank itself has failed. We can confirm on site, but you should be prepared that it's likely a replacement rather than a repair."),
  turn("Caller", 74.0, 79.6, "Yeah, I was afraid of that. What does a replacement run, ballpark? I'm not going to hold you to it."),
  turn("Business", 80.0, 93.2, "For a standard 50 gallon gas tank, installed, with haul-away of the old unit, you're typically looking at somewhere between eighteen hundred and twenty-four hundred depending on the model and whether the venting needs updating. The technician will give you a firm quote before any work starts."),
  turn("Caller", 93.7, 98.3, "Okay, that's in the range I expected. And you can actually do it today?"),
  turn("Business", 98.7, 108.4, "Let me check the board. We have a technician finishing a job in Gilbert around one thirty, so we could have someone at your place between two and four this afternoon. Does that window work?"),
  turn("Caller", 108.9, 113.1, "Two to four works. I'll work from home this afternoon so I'll be here."),
  turn("Business", 113.5, 121.0, "Great. There's a seventy-nine dollar diagnostic fee for the visit, which we waive if you go ahead with the replacement. Is that alright?"),
  turn("Caller", 121.4, 123.6, "That's fine, that's fair."),
  turn("Business", 124.0, 131.8, "Wonderful. I've got you booked, Marcus, two to four today at 4471 Juniper Lane. You'll get a text when the technician is on the way with his name and a photo."),
  turn("Caller", 132.2, 137.4, "Awesome. One more thing, do you guys take a card, or should I have a check ready?"),
  turn("Business", 137.8, 142.0, "Card is perfect, the technician has a reader with him. Checks work too."),
  turn("Caller", 142.4, 145.1, "Great. Okay, thank you so much, Dana, you've been really helpful."),
  turn("Business", 145.5, 149.9, "You're welcome. Keep that supply valve off and put a towel down. We'll see you this afternoon."),
  turn("Caller", 150.2, 151.5, "Will do. Bye."),
  turn("Business", 151.8, 153.0, "Bye now."),
];

export function demoNeighbors(workspaceId: string): CallNeighbors {
  return {
    previous: { id: "demo-previous", workspaceId, callerNumber: "+14805550177", startedAt: at(-47 * 60) },
    next: { id: "demo-next", workspaceId, callerNumber: "+16025550131", startedAt: at(38 * 60) },
  };
}

export function demoCallDetail(workspaceId: string): CallDetail {
  return {
    id: "demo",
    workspace: { id: workspaceId, name: "Acme Plumbing", reportingTimezone: "America/Phoenix" },
    callerNumber: "+14805550142",
    trackingNumber: "+14805550100",
    destinationNumber: "+14805550199",
    state: "Completed",
    outcome: "Answered",
    startedAt: at(0),
    endedAt: at(demoDurationSeconds + 9),
    totalDurationSeconds: demoDurationSeconds + 9,
    connectedDurationSeconds: demoDurationSeconds,
    spamGate: "Passed",
    recording: { state: "Ready", id: "demo", channels: 2, lanes: ["Caller", "Business"], durationSeconds: demoDurationSeconds, waveform: true, expiresAt: "2027-10-21T15:04:05.000Z" },
    mp3RecordingId: "demo",
    transcript: { state: "Completed", turns: demoTurns },
    leadAssessment: {
      state: "Completed",
      classification: "Good Lead",
      score: 86,
      summary: "A homeowner with a failed 13-year-old water heater booked a same-day replacement visit and accepted the diagnostic fee.",
      rationale:
        "The Caller described an active leak, gave a service address inside the Workspace's area, accepted the quoted price range, and agreed to a two-to-four arrival window with the diagnostic fee. Nothing suggests a vendor, a wrong number, or an existing customer following up on prior work.",
      processedAt: at(demoDurationSeconds + 190),
      evidence: [
        { turnIndex: 1, startMs: 4900, quote: "My water heater is leaking from the bottom" },
        { turnIndex: 15, startMs: 108900, quote: "Two to four works. I'll work from home this afternoon" },
        { turnIndex: 17, startMs: 121400, quote: "That's fine, that's fair." },
      ],
    },
    timeline: [
      { id: "event-1", label: "Call received", status: "Completed", at: at(0) },
      { id: "event-2", label: "Keypad Gate passed", status: "Completed", at: at(6) },
      { id: "event-3", label: "Forwarded to Destination Number", status: "Completed", at: at(9) },
      { id: "event-4", label: "Call completed", status: "Completed", at: at(demoDurationSeconds + 9) },
      { id: "recording-transfer", label: "Recording stored", status: "Completed", at: at(demoDurationSeconds + 41) },
      { id: "recording-waveform", label: "Waveform generated", status: "Completed", at: at(demoDurationSeconds + 58) },
      { id: "transcript", label: "Transcript completed", status: "Completed", at: at(demoDurationSeconds + 140) },
      { id: "lead-assessment", label: "Lead Assessment completed", status: "Completed", at: at(demoDurationSeconds + 190) },
      { id: "lead-review", label: "Lead Review added", status: "Completed", at: at(3600 * 2) },
    ],
    leadReview: { classification: "Good Lead", note: "Booked. Tech confirmed tank failure on site; replaced same day.", reviewerName: "Jaedon Spurlock", reviewedAt: at(3600 * 2) },
    effectiveLeadClassification: { classification: "Good Lead", source: "review" },
    twilioCallSid: "CA7f3c1d2e9a4b5c6d7e8f9a0b1c2d3e4f",
  };
}
