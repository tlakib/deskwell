import type { Category, Language, MessageTemplate, Reminder, Schedule, Settings } from "./types";
import { SettingsSchema } from "./types";

export const CATEGORY_META: Record<Category, { label: string; icon: string; title: string }> = {
  water: { label: "Water", icon: "droplet", title: "Time for some water" },
  stand: { label: "Stand up", icon: "arrow-up", title: "Time to stand up" },
  walk: { label: "Walk / Move", icon: "footprints", title: "Time to move" },
  eyes: { label: "Eye rest", icon: "eye", title: "Rest your eyes" },
  stretch: { label: "Stretching", icon: "stretch", title: "Gentle stretch" },
  posture: { label: "Posture check", icon: "posture", title: "Posture check" },
  breathing: { label: "Breathing", icon: "wind", title: "Take a breath" },
  rest: { label: "Short rest", icon: "coffee", title: "Short break" },
  meal: { label: "Meal break", icon: "utensils", title: "Meal time" },
  custom: { label: "Custom", icon: "bell", title: "Reminder" },
};

type TemplateSeed = [Category, Language, string];

const SEEDS: TemplateSeed[] = [
  ["walk", "en", "Time to move. Please stand up and take a gentle two-minute walk."],
  ["stand", "en", "You've been sitting for a while. Stand up and change your position for a moment."],
  ["water", "en", "Take a moment to drink some water if you need it."],
  ["eyes", "en", "Look away from the screen and focus on something in the distance for 20 seconds."],
  ["stretch", "en", "Give your shoulders and wrists a gentle stretch. Stop if anything hurts."],
  ["rest", "en", "You have been working for a while. Take a short break."],
  ["posture", "en", "Quick posture check: relax your shoulders, feet flat, screen at eye level."],
  ["breathing", "en", "Breathe in slowly for four counts, hold for four, and breathe out for six. Repeat a few times."],
  ["meal", "en", "It's time for a proper meal break. Step away from the desk and enjoy it."],
  ["custom", "en", "This is your DeskWell reminder."],
  ["walk", "bn", "অনেকক্ষণ ধরে বসে কাজ করছেন। এবার একটু উঠে দাঁড়ান এবং দুই মিনিট হাঁটাচলা করুন।"],
  ["stand", "bn", "অনেকক্ষণ বসে আছেন। একটু উঠে দাঁড়ান।"],
  ["water", "bn", "একটু বিরতি নিন। আপনার সুবিধামতো কিছু পানি পান করে নিন।"],
  ["eyes", "bn", "স্ক্রিন থেকে চোখ সরিয়ে দূরের কোনো কিছুর দিকে ২০ সেকেন্ড তাকিয়ে থাকুন।"],
  ["stretch", "bn", "চলুন, একটু হালকা স্ট্রেচিং করি। ব্যথা লাগলে থেমে যান।"],
  ["rest", "bn", "কাজের মাঝখানে ছোট বিরতি নেওয়া ভালো। কয়েক মিনিট বিশ্রাম নিন।"],
  ["posture", "bn", "একটু সোজা হয়ে বসুন, কাঁধ শিথিল রাখুন।"],
  ["breathing", "bn", "ধীরে ধীরে গভীর শ্বাস নিন, তারপর আস্তে আস্তে ছাড়ুন।"],
  ["meal", "bn", "খাবারের সময় হয়েছে। ডেস্ক থেকে উঠে আরাম করে খেয়ে নিন।"],
  ["custom", "bn", "এটি আপনার DeskWell রিমাইন্ডার।"],
  ["walk", "de", "Zeit, sich kurz zu bewegen. Steh bitte auf und geh ein paar Minuten."],
  ["stand", "de", "Du sitzt schon eine Weile. Steh kurz auf und ändere deine Haltung."],
  ["water", "de", "Mach eine kurze Pause und trink etwas Wasser, wenn du möchtest."],
  ["eyes", "de", "Schau vom Bildschirm weg und richte deinen Blick für 20 Sekunden in die Ferne."],
  ["stretch", "de", "Dehne sanft Schultern und Handgelenke. Hör auf, wenn etwas weh tut."],
  ["rest", "de", "Du arbeitest schon eine Weile. Gönn dir eine kurze Pause."],
  ["posture", "de", "Haltungscheck: Schultern locker, Füße auf den Boden, Bildschirm auf Augenhöhe."],
  ["breathing", "de", "Atme langsam vier Sekunden ein, halte kurz und atme sechs Sekunden aus."],
  ["meal", "de", "Zeit für eine richtige Essenspause. Geh kurz weg vom Schreibtisch."],
  ["custom", "de", "Das ist deine DeskWell-Erinnerung."],
];

export function defaultTemplates(): MessageTemplate[] {
  return SEEDS.map(([category, language, text], i) => ({
    id: `tpl-${category}-${language}-${i}`,
    category,
    language,
    text,
    order: i,
    builtIn: true,
  }));
}

export function defaultSettings(now: string): Settings {
  return SettingsSchema.parse({
    profiles: [
      { id: "office", name: "Office Work", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", breaks: [{ name: "Lunch", start: "13:00", end: "14:00" }] },
      { id: "study", name: "Study", days: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00", breaks: [] },
      { id: "personal", name: "Personal", days: [6, 7], start: "10:00", end: "20:00", breaks: [] },
      { id: "night", name: "Night Shift", days: [1, 2, 3, 4, 5], start: "22:00", end: "06:00", breaks: [] },
    ],
    quietHours: [{ id: "night", enabled: true, start: "22:30", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }],
    voiceProfiles: [{ id: "default", name: "System default", language: "en", voiceName: null, provider: "system", rate: 1, pitch: 1, volume: 1 }],
    defaultVoiceProfileId: "default",
    updatedAt: now,
  });
}

function interval(minutes: number, extra: Partial<Schedule> = {}): Schedule {
  return {
    type: "interval",
    intervalMinutes: minutes,
    times: [],
    days: [1, 2, 3, 4, 5],
    dates: [],
    onceAt: null,
    window: null,
    useWorkHours: true,
    startDate: null,
    endDate: null,
    ...extra,
  };
}

export function newReminder(now: string, id: string, partial: Partial<Reminder> & Pick<Reminder, "name" | "category">): Reminder {
  return {
    messages: [],
    randomMessage: true,
    language: "en",
    enabled: true,
    schedule: interval(60),
    delivery: "popup_voice",
    voice: { mode: "pack", packId: "akib", profileId: null, audioIds: [], randomAudio: false, volume: 1 },
    snoozeOptions: [5, 10, 15],
    snoozePolicy: "wait",
    priority: "normal",
    respectQuietHours: true,
    group: true,
    pauseInFocus: true,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    id,
    ...partial,
  };
}

/** Starter defaults. Product defaults, not medical prescriptions; every one is editable. */
export function defaultReminders(now: string): Reminder[] {
  return [
    newReminder(now, "builtin-eyes", { name: "Eye rest (20-20-20)", category: "eyes", schedule: interval(20), delivery: "popup" }),
    newReminder(now, "builtin-stand", { name: "Stand & move", category: "walk", schedule: interval(30) }),
    newReminder(now, "builtin-stretch", { name: "Stretch", category: "stretch", schedule: interval(50) }),
    newReminder(now, "builtin-water", { name: "Water", category: "water", schedule: interval(60) }),
    newReminder(now, "builtin-posture", { name: "Posture check", category: "posture", schedule: interval(45), delivery: "popup", enabled: false }),
    newReminder(now, "builtin-breathing", { name: "Breathing break", category: "breathing", schedule: interval(90), enabled: false }),
    newReminder(now, "builtin-meal", {
      name: "Lunch break",
      category: "meal",
      priority: "important",
      group: false,
      schedule: { ...interval(60), type: "daily", times: ["13:00"], useWorkHours: false },
    }),
  ];
}
