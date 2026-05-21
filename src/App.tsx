import type { Session, User } from "@supabase/supabase-js";
import {
  BookOpen,
  ChevronLeft,
  CreditCard,
  Crown,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trash2,
  Upload,
  Download,
  Info,
  Plus,
  Check
} from "lucide-react";
import { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseEpub, ReaderBook, ReaderParagraph } from "./epub";
import { createEdgeTtsPlayer, EdgeTtsPlayer } from "./edgeTts";
import { supabase } from "./supabase";
import { LandingPage } from "./LandingPage";



type PlaybackState = "idle" | "playing" | "paused";
type ReaderFontMode = "serif" | "sans";
type SpeechHighlight = {
  end: number;
  paragraphId: string;
  start: number;
};
type WordRange = {
  end: number;
  start: number;
};
type ReaderImageChunk = {
  endWord: number;
  index: number;
  startWord: number;
  text: string;
};
type ReaderImageState = {
  error?: string;
  prompt?: string;
  src?: string;
  status: "loading" | "ready" | "error";
};
type CachedReaderImage = {
  bookId: string;
  createdAt: string;
  endWord: number;
  key: string;
  prompt?: string;
  src: string;
  startWord: number;
};
type BookRow = {
  author: string;
  chapter_count: number;
  cover_url: string | null;
  created_at: string;
  current_index: number;
  file_name: string;
  file_size: number;
  id: string;
  last_opened_at: string | null;
  mime_type: string;
  paragraph_count: number;
  storage_path: string;
  title: string;
  updated_at: string;
  user_id: string;
};
type BillingProfile = {
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  plan: "free" | "pro";
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  user_id: string;
};

const EPUB_BUCKET = "epubs";
const BOOK_CACHE_NAME = "epub-vision-reader-books-v1";
const READER_IMAGE_DB_NAME = "epub-vision-reader-images";
const READER_IMAGE_STORE_NAME = "images";
const READER_IMAGE_CHUNK_WORDS = 1000;
const READER_IMAGE_ACCOUNT_LIMIT = 100;
const USER_STORAGE_QUOTA_BYTES = Number(
  import.meta.env.VITE_USER_STORAGE_QUOTA_BYTES ?? 104_857_600
);

type ClassicBook = {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  downloadUrl: string;
  summary: string;
};

const CURATED_CLASSICS: ClassicBook[] = [
  {
    id: "jane-austen-pride-and-prejudice",
    title: "Pride and Prejudice",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub",
    summary: "A classic romantic novel of manners following Elizabeth Bennet as she navigates issues of manners, upbringing, morality, education, and marriage in the British Regency gentry."
  },
  {
    id: "mary-shelley-frankenstein",
    title: "Frankenstein",
    author: "Mary Shelley",
    coverUrl: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub",
    summary: "The iconic Gothic novel telling the story of Victor Frankenstein, a young scientist who creates a sapient creature in an unorthodox scientific experiment, and its tragic consequences."
  },
  {
    id: "bram-stoker-dracula",
    title: "Dracula",
    author: "Bram Stoker",
    coverUrl: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.epub",
    summary: "The seminal vampire horror novel that introduced Count Dracula and established many conventions of subsequent vampire fantasy, structured as an epistolary sequence of diaries."
  },
  {
    id: "lewis-carroll-alices-adventures-in-wonderland",
    title: "Alice’s Adventures in Wonderland",
    author: "Lewis Carroll",
    coverUrl: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub",
    summary: "A fantastical tale of a young girl named Alice who falls through a rabbit hole into a subterranean fantasy world populated by peculiar, anthropomorphic creatures."
  },
  {
    id: "arthur-conan-doyle-the-adventures-of-sherlock-holmes",
    title: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    coverUrl: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-adventures-of-sherlock-holmes/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-adventures-of-sherlock-holmes/downloads/arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub",
    summary: "A collection of twelve stories featuring the consulting detective Sherlock Holmes and his companion Dr. John H. Watson, showcasing Holmes' brilliant analytical deduction skills."
  },
  {
    id: "f-scott-fitzgerald-the-great-gatsby",
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    coverUrl: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/f-scott-fitzgerald_the-great-gatsby.epub",
    summary: "Set in the Jazz Age on Long Island, the novel depicts narrator Nick Carraway's interactions with mysterious millionaire Jay Gatsby and Gatsby's obsession to reunite with Daisy Buchanan."
  },
  {
    id: "franz-kafka-the-metamorphosis",
    title: "The Metamorphosis",
    author: "Franz Kafka",
    coverUrl: "https://standardebooks.org/ebooks/franz-kafka/the-metamorphosis/willa-muir_edwin-muir/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/franz-kafka/the-metamorphosis/willa-muir_edwin-muir/downloads/franz-kafka_the-metamorphosis_willa-muir_edwin-muir.epub",
    summary: "Gregor Samsa, a traveling salesman, wakes up one morning to find himself inexplicably transformed into a monstrous insect-like creature, dealing with the psychological fallout."
  },
  {
    id: "oscar-wilde-the-picture-of-dorian-gray",
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    coverUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/oscar-wilde_the-picture-of-dorian-gray.epub",
    summary: "A philosophical novel about Dorian Gray, a handsome young man who sells his soul so that a painted portrait of him will age and record his decay, while he remains forever young."
  },
  {
    id: "herman-melville-moby-dick",
    title: "Moby-Dick",
    author: "Herman Melville",
    coverUrl: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/herman-melville_moby-dick.epub",
    summary: "The epic sailor Ishmael's narrative of the obsessive quest of Ahab, captain of the whaling ship Pequod, for revenge on Moby Dick, the giant white whale."
  },
  {
    id: "charles-dickens-a-tale-of-two-cities",
    title: "A Tale of Two Cities",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/charles-dickens_a-tale-of-two-cities.epub",
    summary: "Set in London and Paris before and during the French Revolution, the novel depicts the plight of the French peasantry and the demagogic excesses of the revolutionaries."
  },
  {
    id: "joseph-conrad-heart-of-darkness",
    title: "Heart of Darkness",
    author: "Joseph Conrad",
    coverUrl: "https://standardebooks.org/ebooks/joseph-conrad/heart-of-darkness/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/joseph-conrad/heart-of-darkness/downloads/joseph-conrad_heart-of-darkness.epub",
    summary: "A powerful novella following Charles Marlow's voyage up the Congo River in the Congo Free State, exploring the hypocrisy of European imperialism and the darkness of human nature."
  },
  {
    id: "h-g-wells-the-time-machine",
    title: "The Time Machine",
    author: "H. G. Wells",
    coverUrl: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/h-g-wells_the-time-machine.epub",
    summary: "The pioneering science fiction novella that popularized the concept of time travel using a vehicle, following a Victorian inventor's journey to the far future and the split of humanity."
  },
  {
    id: "h-g-wells-the-war-of-the-worlds",
    title: "The War of the Worlds",
    author: "H. G. Wells",
    coverUrl: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/h-g-wells_the-war-of-the-worlds.epub",
    summary: "One of the earliest and most influential novels detailing an alien invasion, following a nameless narrator as Martians attack Victorian England with advanced technology."
  },
  {
    id: "robert-louis-stevenson-the-strange-case-of-dr-jekyll-and-mr-hyde",
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    author: "Robert Louis Stevenson",
    coverUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde/downloads/robert-louis-stevenson_the-strange-case-of-dr-jekyll-and-mr-hyde.epub",
    summary: "A gothic novella about a London legal practitioner named John Gabriel Utterson who investigates strange occurrences between his old friend, Dr. Henry Jekyll, and the evil Edward Hyde."
  },
  {
    id: "robert-louis-stevenson-treasure-island",
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    coverUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/treasure-island/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/treasure-island/downloads/robert-louis-stevenson_treasure-island.epub",
    summary: "The classic adventure novel telling the story of 'buccaneers and buried gold', following young Jim Hawkins as he boards the Hispaniola to locate Captain Flint's treasure."
  },
  {
    id: "charlotte-bronte-jane-eyre",
    title: "Jane Eyre",
    author: "Charlotte Brontë",
    coverUrl: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/charlotte-bronte_jane-eyre.epub",
    summary: "Following the emotions and experiences of its eponymous heroine, including her growth to adulthood and her love for Mr. Rochester, the master of Thornfield Hall."
  },
  {
    id: "emily-bronte-wuthering-heights",
    title: "Wuthering Heights",
    author: "Emily Brontë",
    coverUrl: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/emily-bronte_wuthering-heights.epub",
    summary: "A passionate story of obsessive love and revenge on the Yorkshire moors, following the tumultuous relationship between Heathcliff and Catherine Earnshaw."
  },
  {
    id: "homer-the-odyssey",
    title: "The Odyssey",
    author: "Homer",
    coverUrl: "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/homer_the-odyssey_william-cullen-bryant.epub",
    summary: "One of two major ancient Greek epic poems, following the Greek hero Odysseus, king of Ithaca, and his journey home after the fall of Troy, translated by William Cullen Bryant."
  },
  {
    id: "homer-the-iliad",
    title: "The Iliad",
    author: "Homer",
    coverUrl: "https://standardebooks.org/ebooks/homer/the-iliad/william-cullen-bryant/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/homer/the-iliad/william-cullen-bryant/downloads/homer_the-iliad_william-cullen-bryant.epub",
    summary: "Set during the ten-year siege of the city of Troy by a coalition of Greek states, detailing the battle between Achilles and King Agamemnon, translated by William Cullen Bryant."
  },
  {
    id: "fyodor-dostoevsky-crime-and-punishment",
    title: "Crime and Punishment",
    author: "Fyodor Dostoevsky",
    coverUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/fyodor-dostoevsky_crime-and-punishment_constance-garnett.epub",
    summary: "Following Rodion Raskolnikov, an impoverished ex-student in Saint Petersburg who formulates a plan to kill an unscrupulous pawnbroker for her money, translated by Constance Garnett."
  },
  {
    id: "fyodor-dostoevsky-the-brothers-karamazov",
    title: "The Brothers Karamazov",
    author: "Fyodor Dostoevsky",
    coverUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/the-brothers-karamazov/constance-garnett/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/the-brothers-karamazov/constance-garnett/downloads/fyodor-dostoevsky_the-brothers-karamazov_constance-garnett.epub",
    summary: "A passionate philosophical novel that enters deeply into the questions of God, free will, and morality, detailing the drama of the Karamazov family, translated by Constance Garnett."
  },
  {
    id: "henry-david-thoreau-walden",
    title: "Walden",
    author: "Henry David Thoreau",
    coverUrl: "https://standardebooks.org/ebooks/henry-david-thoreau/walden/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/henry-david-thoreau/walden/downloads/henry-david-thoreau_walden.epub",
    summary: "Thoreau's reflection upon simple living in natural surroundings, detailing his experiences over two years in a cabin he built near Walden Pond, Massachusetts."
  },
  {
    id: "walt-whitman-leaves-of-grass",
    title: "Leaves of Grass",
    author: "Walt Whitman",
    coverUrl: "https://standardebooks.org/ebooks/walt-whitman/leaves-of-grass/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/walt-whitman/leaves-of-grass/downloads/walt-whitman_leaves-of-grass.epub",
    summary: "A landmark poetry collection in American literature, celebrating nature, humanity, individualism, and the sensual experience of the human spirit."
  },
  {
    id: "alexandre-dumas-the-count-of-monte-cristo",
    title: "The Count of Monte Cristo",
    author: "Alexandre Dumas",
    coverUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/anonymous/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/anonymous/downloads/alexandre-dumas_the-count-of-monte-cristo_anonymous.epub",
    summary: "Following Edmond Dantès, a young French sailor who is falsely accused of treason, escapes from prison, and seeks retribution against his betrayers."
  },
  {
    id: "alexandre-dumas-the-three-musketeers",
    title: "The Three Musketeers",
    author: "Alexandre Dumas",
    coverUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-three-musketeers/william-robson/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-three-musketeers/william-robson/downloads/alexandre-dumas_the-three-musketeers_william-robson.epub",
    summary: "The adventures of young d'Artagnan as he travels to Paris to join the Musketeers of the Guard, befriending Athos, Porthos, and Aramis, translated by William Robson."
  },
  {
    id: "charles-dickens-great-expectations",
    title: "Great Expectations",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/great-expectations/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/great-expectations/downloads/charles-dickens_great-expectations.epub",
    summary: "Pip, an orphan growing up in a humble blacksmith's household, is suddenly elevated to the rank of gentleman by an anonymous benefactor, navigating London high society."
  },
  {
    id: "charles-dickens-oliver-twist",
    title: "Oliver Twist",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/oliver-twist/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/oliver-twist/downloads/charles-dickens_oliver-twist.epub",
    summary: "The story of the orphan Oliver Twist, who starts his life in a workhouse and is then apprenticed with an undertaker, escaping to London and finding a gang of juvenile pickpockets."
  },
  {
    id: "charles-dickens-a-christmas-carol",
    title: "A Christmas Carol",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/a-christmas-carol/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/a-christmas-carol/downloads/charles-dickens_a-christmas-carol.epub",
    summary: "The transformation of Ebenezer Scrooge, a miserly old businessman, after he is visited by the ghosts of Christmas Past, Present, and Yet to Come."
  },
  {
    id: "franz-kafka-the-trial",
    title: "The Trial",
    author: "Franz Kafka",
    coverUrl: "https://standardebooks.org/ebooks/franz-kafka/the-trial/david-wyllie/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/franz-kafka/the-trial/david-wyllie/downloads/franz-kafka_the-trial_david-wyllie.epub",
    summary: "Following Josef K., a respectable bank officer who is suddenly arrested and must defend himself against a charge about which he can obtain no information, translated by David Wyllie."
  },
  {
    id: "james-joyce-dubliners",
    title: "Dubliners",
    author: "James Joyce",
    coverUrl: "https://standardebooks.org/ebooks/james-joyce/dubliners/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/dubliners/downloads/james-joyce_dubliners.epub",
    summary: "A collection of fifteen short stories depicting Irish middle-class life in and around Dublin in the early years of the 20th century, exploring moments of epiphany."
  },
  {
    id: "james-joyce-a-portrait-of-the-artist-as-a-young-man",
    title: "A Portrait of the Artist as a Young Man",
    author: "James Joyce",
    coverUrl: "https://standardebooks.org/ebooks/james-joyce/a-portrait-of-the-artist-as-a-young-man/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/a-portrait-of-the-artist-as-a-young-man/downloads/james-joyce_a-portrait-of-the-artist-as-a-young-man.epub",
    summary: "A semi-autobiographical novel tracing the intellectual, philosophical, and aesthetic awakening of Stephen Dedalus, a young man who rebels against his Catholic upbringing."
  },
  {
    id: "james-joyce-ulysses",
    title: "Ulysses",
    author: "James Joyce",
    coverUrl: "https://standardebooks.org/ebooks/james-joyce/ulysses/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/ulysses/downloads/james-joyce_ulysses.epub",
    summary: "A modern masterpiece chronicling the passage of Leopold Bloom through Dublin in the course of an ordinary day, establishing parallels to Homer's epic Odyssey."
  },
  {
    id: "jonathan-swift-gullivers-travels",
    title: "Gulliver’s Travels",
    author: "Jonathan Swift",
    coverUrl: "https://standardebooks.org/ebooks/jonathan-swift/gullivers-travels/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jonathan-swift/gullivers-travels/downloads/jonathan-swift_gullivers-travels.epub",
    summary: "A brilliant satire of human nature and traveler's tales, following Lemuel Gulliver's voyages to Lilliput, Brobdingnag, Laputa, and the land of the Houyhnhnms."
  },
  {
    id: "kenneth-grahame-the-wind-in-the-willows",
    title: "The Wind in the Willows",
    author: "Kenneth Grahame",
    coverUrl: "https://standardebooks.org/ebooks/kenneth-grahame/the-wind-in-the-willows/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/kenneth-grahame/the-wind-in-the-willows/downloads/kenneth-grahame_the-wind-in-the-willows.epub",
    summary: "The charming adventures of Mole, Water Rat, Badger, and the eccentric Mr. Toad of Toad Hall, exploring the Thames Valley wilderness and themes of friendship."
  },
  {
    id: "jack-london-the-call-of-the-wild",
    title: "The Call of the Wild",
    author: "Jack London",
    coverUrl: "https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild/downloads/jack-london_the-call-of-the-wild.epub",
    summary: "Set in the Yukon Territory during the Klondike Gold Rush, following Buck, a domesticated dog who is stolen, sold into service, and reverts to wild instincts."
  },
  {
    id: "jack-london-white-fang",
    title: "White Fang",
    author: "Jack London",
    coverUrl: "https://standardebooks.org/ebooks/jack-london/white-fang/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jack-london/white-fang/downloads/jack-london_white-fang.epub",
    summary: "A companion novel to Call of the Wild, focusing on a wild wolf-dog's journey to domestication in the Yukon Territory during the Gold Rush."
  },
  {
    id: "george-bernard-shaw-pygmalion",
    title: "Pygmalion",
    author: "George Bernard Shaw",
    coverUrl: "https://standardebooks.org/ebooks/george-bernard-shaw/pygmalion/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/george-bernard-shaw/pygmalion/downloads/george-bernard-shaw_pygmalion.epub",
    summary: "A brilliant play about Henry Higgins, a professor of phonetics, who makes a bet that he can train a bedraggled Cockney flower girl, Eliza Doolittle, to pass for a duchess."
  },
  {
    id: "leo-tolstoy-anna-karenina",
    title: "Anna Karenina",
    author: "Leo Tolstoy",
    coverUrl: "https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett/downloads/leo-tolstoy_anna-karenina_constance-garnett.epub",
    summary: "A complex novel in eight parts, tracing the tragic extramarital affair between the socialite Anna Karenina and the dashing cavalry officer Count Vronsky, translated by Constance Garnett."
  },
  {
    id: "leo-tolstoy-war-and-peace",
    title: "War and Peace",
    author: "Leo Tolstoy",
    coverUrl: "https://standardebooks.org/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude/downloads/leo-tolstoy_war-and-peace_louise-maude_aylmer-maude.epub",
    summary: "An epic chronicle of the history of the French invasion of Russia and the impact of the Napoleonic era on Tsarist society through five Russian aristocratic families."
  },
  {
    id: "oscar-wilde-the-importance-of-being-earnest",
    title: "The Importance of Being Earnest",
    author: "Oscar Wilde",
    coverUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-importance-of-being-earnest/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-importance-of-being-earnest/downloads/oscar-wilde_the-importance-of-being-earnest.epub",
    summary: "A farcical comedy in which the protagonists maintain fictitious personae in order to escape burdensome social obligations, showcasing Wilde's sharp wit."
  },
  {
    id: "jane-austen-sense-and-sensibility",
    title: "Sense and Sensibility",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/sense-and-sensibility/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/sense-and-sensibility/downloads/jane-austen_sense-and-sensibility.epub",
    summary: "Following the Dashwood sisters, Elinor (representing sense) and Marianne (representing sensibility), as they navigate romance, family, and financial hardship."
  },
  {
    id: "jane-austen-emma",
    title: "Emma",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/jane-austen_emma.epub",
    summary: "Emma Woodhouse, beautiful, clever, and rich, has a very happy home and little to distress her. But she has an unfortunate habit of matchmaking in her small village."
  },
  {
    id: "jane-austen-persuasion",
    title: "Persuasion",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/persuasion/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/persuasion/downloads/jane-austen_persuasion.epub",
    summary: "The story of Anne Elliot, who, years after breaking her engagement to naval captain Frederick Wentworth, meets him again and must navigate unresolved feelings."
  },
  {
    id: "niccolo-machiavelli-the-prince",
    title: "The Prince",
    author: "Niccolò Machiavelli",
    coverUrl: "https://standardebooks.org/ebooks/niccolo-machiavelli/the-prince/w-k-marriott/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/niccolo-machiavelli/the-prince/w-k-marriott/downloads/niccolo-machiavelli_the-prince_w-k-marriott.epub",
    summary: "The classic political treatise on statecraft, describing how a ruler should acquire, maintain, and govern a principality, translated by W. K. Marriott."
  },
  {
    id: "friedrich-nietzsche-beyond-good-and-evil",
    title: "Beyond Good and Evil",
    author: "Friedrich Nietzsche",
    coverUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern/downloads/friedrich-nietzsche_beyond-good-and-evil_helen-zimmern.epub",
    summary: "A fundamental critique of traditional morality and philosophy, introducing Nietzsche's concepts of the will to power and master-slave moralities."
  },
  {
    id: "friedrich-nietzsche-thus-spoke-zarathustra",
    title: "Thus Spoke Zarathustra",
    author: "Friedrich Nietzsche",
    coverUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/thus-spake-zarathustra/thomas-common/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/thus-spake-zarathustra/thomas-common/downloads/friedrich-nietzsche_thus-spake-zarathustra_thomas-common.epub",
    summary: "A philosophical novel containing the fictional travels and speeches of Zarathustra, introducing the concepts of the Übermensch and eternal recurrence."
  },
  {
    id: "kahlil-gibran-the-prophet",
    title: "The Prophet",
    author: "Kahlil Gibran",
    coverUrl: "https://standardebooks.org/ebooks/khalil-gibran/the-prophet/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/khalil-gibran/the-prophet/downloads/khalil-gibran_the-prophet.epub",
    summary: "A book of 26 poetic essays delivered by the prophet Almustafa, offering spiritual insights on love, marriage, children, work, joy, sorrow, and death."
  },
  {
    id: "frances-hodgson-burnett-the-secret-garden",
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    coverUrl: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden/downloads/frances-hodgson-burnett_the-secret-garden.epub",
    summary: "Following Mary Lennox, a spoiled and unloved orphan who is sent to Yorkshire to live with her uncle, discovering a locked and neglected secret garden."
  },
  {
    id: "j-m-barrie-peter-and-wendy",
    title: "Peter and Wendy",
    author: "J. M. Barrie",
    coverUrl: "https://standardebooks.org/ebooks/j-m-barrie/peter-and-wendy/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/j-m-barrie/peter-and-wendy/downloads/j-m-barrie_peter-and-wendy.epub",
    summary: "The classic fantasy story of Peter Pan, the boy who wouldn't grow up, as he takes Wendy Darling and her brothers to the magical island of Neverland."
  },
  {
    id: "brothers-grimm-fairy-tales",
    title: "Grimms’ Fairy Tales",
    author: "Brothers Grimm",
    coverUrl: "https://standardebooks.org/ebooks/jacob-grimm_wilhelm-grimm/household-tales/margaret-hunt/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jacob-grimm_wilhelm-grimm/household-tales/margaret-hunt/downloads/jacob-grimm_wilhelm-grimm_household-tales_margaret-hunt.epub",
    summary: "A renowned collection of German folklore and fairy tales, including Cinderella, Hansel and Gretel, Rapunzel, Rumpelstiltskin, and Sleeping Beauty."
  }
];


const wordRangesFromText = (text: string): WordRange[] =>
  Array.from(text.matchAll(/\S+/g)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));

const wordsFromText = (text: string) => Array.from(text.matchAll(/\S+/g)).map((match) => match[0]);

const bookWords = (book: ReaderBook) =>
  book.paragraphs.flatMap((paragraph) => (paragraph.kind === "image" ? [] : wordsFromText(paragraph.text)));

const buildReaderImageChunks = (book: ReaderBook, startOffset = 0, chunkSize = READER_IMAGE_CHUNK_WORDS): ReaderImageChunk[] => {
  const allWords = bookWords(book);
  const safeStartOffset = Math.max(0, Math.min(startOffset, Math.max(0, allWords.length - 1)));
  const chunks: ReaderImageChunk[] = [];

  for (let offset = safeStartOffset; offset < allWords.length; offset += chunkSize) {
    const words = allWords.slice(offset, offset + chunkSize);
    if (!words.length) break;
    chunks.push({
      endWord: offset + words.length,
      index: chunks.length,
      startWord: offset + 1,
      text: words.join(" ")
    });
  }

  return chunks;
};

const wordOffsetForParagraph = (book: ReaderBook, targetIndex: number) =>
  book.paragraphs.slice(0, targetIndex).reduce((total, paragraph) => {
    if (paragraph.kind === "image") return total;
    return total + wordsFromText(paragraph.text).length;
  }, 0);

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const safeFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "book.epub";

const coverPalettes = [
  "linear-gradient(145deg, #232323 0%, #5a4f3f 100%)",
  "linear-gradient(145deg, #18313f 0%, #d17a45 100%)",
  "linear-gradient(145deg, #2d2a32 0%, #7f8c6f 100%)",
  "linear-gradient(145deg, #143d3d 0%, #d6b35a 100%)",
  "linear-gradient(145deg, #3b2636 0%, #b9685b 100%)",
  "linear-gradient(145deg, #1f3048 0%, #b6a66a 100%)"
];

const getBookHue = (book: Pick<BookRow, "id" | "title">) => {
  const seed = `${book.id}-${book.title}`;
  const hash = Array.from(seed).reduce((value, char) => value + char.charCodeAt(0), 0);
  return coverPalettes[hash % coverPalettes.length];
};

const getCoverInitials = (title: string) =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "EP";

function BookCover({ book }: { book: BookRow }) {
  const [hasError, setHasError] = useState(false);

  return (
    <span className="catalog-cover-art">
      {!book.cover_url || hasError ? (
        <span className="generated-cover" style={{ background: getBookHue(book) }}>
          <span className="fallback-title">{book.title}</span>
        </span>
      ) : (
        <img
          alt={book.title}
          src={book.cover_url}
          onError={() => setHasError(true)}
        />
      )}
    </span>
  );
}

const authRedirectUrl = () => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
};

const initialReaderFontMode = (): ReaderFontMode =>
  window.localStorage.getItem("reader-font-mode") === "sans" ? "sans" : "serif";

const getOpenLibraryCoverUrl = async (title: string, author: string) => {
  const params = new URLSearchParams({
    title,
    fields: "cover_i",
    limit: "1"
  });
  if (author) params.set("author", author);

  let response: Response;
  try {
    response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
  } catch {
    return "";
  }

  if (!response.ok) return "";

  let result: { docs?: Array<{ cover_i?: number }> };
  try {
    result = (await response.json()) as { docs?: Array<{ cover_i?: number }> };
  } catch {
    return "";
  }
  const coverId = result.docs?.find((doc) => typeof doc.cover_i === "number")?.cover_i;
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "";
};

const shrinkCoverDataUrl = async (coverUrl: string) => {
  if (!coverUrl.startsWith("data:image/") || coverUrl.startsWith("data:image/svg")) return coverUrl;

  const image = new Image();
  image.decoding = "async";
  image.src = coverUrl;

  try {
    await image.decode();
  } catch {
    return coverUrl;
  }

  // Always resize and compress to keep database payloads highly efficient (~8KB-15KB)
  const maxWidth = 240;
  const scale = Math.min(1, maxWidth / image.naturalWidth);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) return coverUrl;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
};

const bookCacheRequest = (bookId: string) =>
  new Request(`${window.location.origin}/__book-cache/${encodeURIComponent(bookId)}`);

const readerImageCacheKey = (bookId: string, chunk: Pick<ReaderImageChunk, "endWord" | "startWord">) =>
  `${bookId}:${chunk.startWord}:${chunk.endWord}`;

const openReaderImageDb = () =>
  new Promise<IDBDatabase | null>((resolve) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(READER_IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(READER_IMAGE_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

const getCachedReaderImage = async (bookId: string, chunk: ReaderImageChunk) => {
  const db = await openReaderImageDb();
  if (!db) return null;

  return new Promise<CachedReaderImage | null>((resolve) => {
    const transaction = db.transaction(READER_IMAGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(READER_IMAGE_STORE_NAME).get(readerImageCacheKey(bookId, chunk));
    request.onsuccess = () => resolve((request.result as CachedReaderImage | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const cacheReaderImage = async (image: CachedReaderImage) => {
  const db = await openReaderImageDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(READER_IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(READER_IMAGE_STORE_NAME).put(image);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
};

const getCachedBookFile = async (row: BookRow) => {
  if (!("caches" in window)) return null;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    const response = await cache.match(bookCacheRequest(row.id));
    if (!response) return null;

    const blob = await response.blob();
    if (row.file_size > 0 && blob.size !== row.file_size) {
      await cache.delete(bookCacheRequest(row.id));
      return null;
    }

    return new File([blob], row.file_name, { type: row.mime_type || blob.type || "application/epub+zip" });
  } catch (error) {
    console.warn("Could not read EPUB from browser cache.", error);
    return null;
  }
};

const cacheBookFile = async (row: BookRow, file: Blob) => {
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.put(
      bookCacheRequest(row.id),
      new Response(file, {
        headers: {
          "Content-Type": row.mime_type || file.type || "application/epub+zip"
        }
      })
    );
  } catch (error) {
    console.warn("Could not store EPUB in browser cache.", error);
  }
};

const deleteCachedBookFile = async (bookId: string) => {
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.delete(bookCacheRequest(bookId));
  } catch (error) {
    console.warn("Could not remove EPUB from browser cache.", error);
  }
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [catalogBooks, setCatalogBooks] = useState<BookRow[]>([]);
  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
  const [activeBookId, setActiveBookId] = useState("");
  const [view, setView] = useState<"catalog" | "reader">("catalog");
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [readerFontMode, setReaderFontMode] = useState<ReaderFontMode>(initialReaderFontMode);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<"success" | "canceled" | "">("");
  const [speechHighlight, setSpeechHighlight] = useState<SpeechHighlight | null>(null);
  const [readerImageMode, setReaderImageMode] = useState(false);
  const [readerImageAnchorWordOffset, setReaderImageAnchorWordOffset] = useState(0);
  const [readerImages, setReaderImages] = useState<Record<number, ReaderImageState>>({});
  const [readerImageCount, setReaderImageCount] = useState(0);
  const parsedBooks = useRef(new Map<string, ReaderBook>());
  const readingSurfaceRef = useRef<HTMLElement | null>(null);
  const paragraphRefs = useRef(new Map<string, HTMLElement>());
  const chapterRefs = useRef(new Map<number, HTMLButtonElement>());
  const imageRequestsRef = useRef(new Set<number>());
  const readerImageModeRef = useRef(false);
  const readerImageRunRef = useRef(0);
  const pendingScrollIndex = useRef<number | null>(null);
  const edgeTtsPlayerRef = useRef<EdgeTtsPlayer | null>(null);
  const progressSaveTimer = useRef<number | null>(null);
  const coverLookupRef = useRef(new Set<string>());

  const [importingClassicId, setImportingClassicId] = useState<string | null>(null);
  const [activeSynopsisId, setActiveSynopsisId] = useState<string | null>(null);

  const user = session?.user ?? null;
  const current = book?.paragraphs[currentIndex];
  const progress = book ? ((currentIndex + 1) / book.paragraphs.length) * 100 : 0;
  const storageUsed = catalogBooks.reduce((total, item) => total + item.file_size, 0);
  const isPro = billingProfile?.plan === "pro";
  const currentReaderWordOffset = useMemo(
    () => (book ? wordOffsetForParagraph(book, currentIndex) : 0),
    [book, currentIndex]
  );
  const readerImageStartOffset = readerImageMode ? readerImageAnchorWordOffset : currentReaderWordOffset;
  const readerImageChunks = useMemo(
    () => (book ? buildReaderImageChunks(book, readerImageStartOffset) : []),
    [book, readerImageStartOffset]
  );
  const activeReaderImageChunkIndex = useMemo(() => {
    if (!book || !readerImageChunks.length) return -1;
    const relativeWordOffset = Math.max(0, currentReaderWordOffset - readerImageStartOffset);
    return Math.min(readerImageChunks.length - 1, Math.floor(relativeWordOffset / READER_IMAGE_CHUNK_WORDS));
  }, [book, currentReaderWordOffset, readerImageChunks, readerImageStartOffset]);
  const visibleReaderImageIndexes = useMemo(() => {
    if (!readerImageMode || activeReaderImageChunkIndex < 0) return new Set<number>();
    return new Set([activeReaderImageChunkIndex, activeReaderImageChunkIndex + 1]);
  }, [activeReaderImageChunkIndex, readerImageMode]);
  const isReaderImageLoading =
    readerImageMode &&
    activeReaderImageChunkIndex >= 0 &&
    [readerImages[activeReaderImageChunkIndex], readerImages[activeReaderImageChunkIndex + 1]].some(
      (image) => image?.status === "loading"
    );
  const readerImageInsertions = useMemo(() => {
    const insertions = new Map<number, ReaderImageChunk[]>();
    if (!book || !readerImageMode || !readerImageChunks.length) return insertions;

    let wordOffset = 0;
    let chunkIndex = 0;

    book.paragraphs.forEach((paragraph, paragraphIndex) => {
      const wordCount = paragraph.kind === "image" ? 0 : wordsFromText(paragraph.text).length;
      const paragraphStart = wordOffset;
      const paragraphEnd = wordOffset + wordCount;

      while (
        chunkIndex < readerImageChunks.length &&
        wordCount > 0 &&
        readerImageChunks[chunkIndex].startWord - 1 >= paragraphStart &&
        readerImageChunks[chunkIndex].startWord - 1 < paragraphEnd
      ) {
        const chunk = readerImageChunks[chunkIndex];
        if (visibleReaderImageIndexes.has(chunk.index) || readerImages[chunk.index]) {
          const items = insertions.get(paragraphIndex) ?? [];
          items.push(chunk);
          insertions.set(paragraphIndex, items);
        }
        chunkIndex += 1;
      }

      wordOffset = paragraphEnd;
    });

    return insertions;
  }, [book, readerImageChunks, readerImageMode, readerImages, visibleReaderImageIndexes]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setCatalogBooks([]);
      setBillingProfile(null);
      setReaderImageCount(0);
      setBook(null);
      setView("catalog");
      setActiveBookId("");
      coverLookupRef.current.clear();
      return;
    }

    void loadLibrary(user);
    void loadBillingProfile(user);
    void loadReaderImageUsage();
  }, [user?.id]);

  useEffect(() => {
    if (!user || !catalogBooks.length) return;

    const hydrateMissingCovers = async () => {
      for (const catalogBook of catalogBooks) {
        if (catalogBook.cover_url || coverLookupRef.current.has(catalogBook.id)) continue;

        coverLookupRef.current.add(catalogBook.id);
        const coverUrl = await getOpenLibraryCoverUrl(catalogBook.title, catalogBook.author);
        if (!coverUrl) continue;

        setCatalogBooks((items) =>
          items.map((item) => (item.id === catalogBook.id ? { ...item, cover_url: coverUrl } : item))
        );
        const { error: updateError } = await supabase.from("books").update({ cover_url: coverUrl }).eq("id", catalogBook.id);
        if (updateError) {
          console.error("Failed to save Open Library cover to database:", updateError);
        }
      }
    };

    void hydrateMissingCovers();
  }, [catalogBooks, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success") {
      setCheckoutResult("success");
      setNotice("Thanks. Your Pro subscription is being confirmed.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (checkout === "canceled") {
      setCheckoutResult("canceled");
      setNotice("Checkout was canceled.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (checkoutResult !== "success" || !user) return;

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      void loadBillingProfile(user);
      if (attempts >= 8) window.clearInterval(interval);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [checkoutResult, user?.id]);

  useEffect(() => stopAudio, []);

  useEffect(() => {
    window.localStorage.setItem("reader-font-mode", readerFontMode);
  }, [readerFontMode]);

  useEffect(() => {
    if (playback !== "playing" || !current) return;

    stopAudio();
    if (current.kind === "image") {
      if (book && currentIndex < book.paragraphs.length - 1) {
        advance();
      } else {
        setPlayback("idle");
      }
      return;
    }

    speakEdge(current);
  }, [currentIndex]);

  useEffect(() => {
    const chapterButton = chapterRefs.current.get(current?.chapterIndex ?? -1);
    chapterButton?.scrollIntoView({ block: "nearest" });
  }, [current?.chapterIndex]);

  useEffect(() => {
    const targetIndex = pendingScrollIndex.current;
    if (targetIndex === null || !book) return;

    pendingScrollIndex.current = null;
    const target = book.paragraphs[targetIndex];
    const node = target ? paragraphRefs.current.get(target.id) : null;
    node?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [book?.paragraphs, currentIndex]);

  useEffect(() => {
    if (!activeBookId || !book || view !== "reader") return;
    if (progressSaveTimer.current !== null) window.clearTimeout(progressSaveTimer.current);

    progressSaveTimer.current = window.setTimeout(() => {
      void saveReadingProgress(activeBookId, currentIndex);
    }, 600);

    return () => {
      if (progressSaveTimer.current !== null) window.clearTimeout(progressSaveTimer.current);
    };
  }, [activeBookId, book, currentIndex, view]);

  useEffect(() => {
    if (!readerImageMode || activeReaderImageChunkIndex < 0) return;
    void ensureReaderImages(activeReaderImageChunkIndex);
  }, [activeReaderImageChunkIndex, readerImageMode]);

  useEffect(() => {
    if (!activeBookId || !book || view !== "reader") return;

    const flushProgress = () => {
      if (progressSaveTimer.current !== null) {
        window.clearTimeout(progressSaveTimer.current);
        progressSaveTimer.current = null;
      }

      void saveReadingProgress(activeBookId, currentIndex);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };

    window.addEventListener("beforeunload", flushProgress);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushProgress);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeBookId, book, currentIndex, view]);

  const generateReaderImage = async (chunk: ReaderImageChunk, runId = readerImageRunRef.current) => {
    if (!book || !activeBookId) return;
    if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
    if (imageRequestsRef.current.has(chunk.index)) return;

    imageRequestsRef.current.add(chunk.index);

    try {
      const cachedImage = await getCachedReaderImage(activeBookId, chunk);
      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
      if (cachedImage?.src) {
        setReaderImages((items) => ({
          ...items,
          [chunk.index]: {
            prompt: cachedImage.prompt,
            src: cachedImage.src,
            status: "ready"
          }
        }));
        return;
      }

      setReaderImages((items) => ({
        ...items,
        [chunk.index]: { status: "loading" }
      }));

      const { data, error } = await supabase.functions.invoke("generate-reader-image", {
        method: "POST",
        body: {
          author: book.author,
          bookId: activeBookId,
          bookTitle: book.title,
          chunkIndex: chunk.index,
          endWord: chunk.endWord,
          startWord: chunk.startWord,
          text: chunk.text
        }
      });

      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
      if (error) throw error;
      if (!data?.imageUrl) throw new Error("Image generation returned no image.");

      const prompt = typeof data.prompt === "string" ? data.prompt : undefined;
      if (typeof data.imageCount === "number") setReaderImageCount(data.imageCount);
      void cacheReaderImage({
        bookId: activeBookId,
        createdAt: new Date().toISOString(),
        endWord: chunk.endWord,
        key: readerImageCacheKey(activeBookId, chunk),
        prompt,
        src: data.imageUrl,
        startWord: chunk.startWord
      });

      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          prompt,
          src: data.imageUrl,
          status: "ready"
        }
      }));
    } catch (error) {
      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          error: error instanceof Error ? error.message : "Could not generate this image.",
          status: "error"
        }
      }));
    } finally {
      if (runId === readerImageRunRef.current) imageRequestsRef.current.delete(chunk.index);
    }
  };

  const ensureReaderImages = async (chunkIndex: number) => {
    const runId = readerImageRunRef.current;
    const targets = [chunkIndex, chunkIndex + 1]
      .map((index) => readerImageChunks[index])
      .filter((chunk): chunk is ReaderImageChunk => Boolean(chunk));

    await Promise.all(
      targets.map((chunk) => {
        const existing = readerImages[chunk.index];
        if (existing?.status === "ready" || existing?.status === "loading") return Promise.resolve();
        return generateReaderImage(chunk, runId);
      })
    );
  };

  const stopReaderImageMode = () => {
    readerImageRunRef.current += 1;
    readerImageModeRef.current = false;
    imageRequestsRef.current.clear();
    setReaderImageMode(false);
    setReaderImages({});
  };

  const toggleReaderImageMode = () => {
    if (readerImageMode) {
      stopReaderImageMode();
      return;
    }

    if (!book || activeReaderImageChunkIndex < 0) return;
    const startOffset = wordOffsetForParagraph(book, currentIndex);
    const anchoredChunks = buildReaderImageChunks(book, startOffset);
    if (!anchoredChunks.length) return;

    const runId = readerImageRunRef.current + 1;
    readerImageRunRef.current = runId;
    readerImageModeRef.current = true;
    imageRequestsRef.current.clear();
    setReaderImages({});
    setReaderImageAnchorWordOffset(startOffset);
    setReaderImageMode(true);
    void Promise.all(anchoredChunks.slice(0, 2).map((chunk) => generateReaderImage(chunk, runId)));
  };

  const loadLibrary = async (_user: User) => {
    setBusy(true);
    setNotice("");

    const { data, error } = await supabase
      .from("books")
      .select("*")
      .order("last_opened_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      setNotice(error.message);
    } else {
      setCatalogBooks((data ?? []) as BookRow[]);
    }

    setBusy(false);
  };

  const loadBillingProfile = async (_user: User) => {
    const { data, error } = await supabase
      .from("billing_profiles")
      .select("*")
      .maybeSingle();

    if (!error) setBillingProfile(data as BillingProfile | null);
  };

  const loadReaderImageUsage = async () => {
    const { count, error } = await supabase
      .from("reader_images")
      .select("id", { count: "exact", head: true });

    if (!error) setReaderImageCount(count ?? 0);
  };

  const saveReadingProgress = async (bookId: string, index: number) => {
    const savedAt = new Date().toISOString();
    const { error } = await supabase
      .from("books")
      .update({ current_index: index, last_opened_at: savedAt })
      .eq("id", bookId);

    if (error) return;

    setCatalogBooks((items) =>
      items.map((item) =>
        item.id === bookId
          ? { ...item, current_index: index, last_opened_at: savedAt, updated_at: savedAt }
          : item
      )
    );
  };

  const stopAudio = () => {
    edgeTtsPlayerRef.current?.stop();
    edgeTtsPlayerRef.current = null;
    setSpeechHighlight(null);
  };

  const advance = () => {
    if (!book) return;
    const target = Math.min(currentIndex + 1, book.paragraphs.length - 1);
    pendingScrollIndex.current = target;
    setCurrentIndex(target);
  };

  const speakEdge = (paragraph: ReaderParagraph) => {
    if (paragraph.kind === "image") return;

    edgeTtsPlayerRef.current?.stop();
    edgeTtsPlayerRef.current = null;
    const wordRanges = wordRangesFromText(paragraph.text);

    if (wordRanges[0]) {
      setSpeechHighlight({ paragraphId: paragraph.id, ...wordRanges[0] });
    } else {
      setSpeechHighlight({ paragraphId: paragraph.id, start: 0, end: 0 });
    }

    edgeTtsPlayerRef.current = createEdgeTtsPlayer({
      onBoundary: (range) => {
        setSpeechHighlight({ paragraphId: paragraph.id, ...range });
      },
      onEnded: () => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        if (book && currentIndex < book.paragraphs.length - 1) {
          advance();
        } else {
          setPlayback("idle");
        }
      },
      onError: () => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        setNotice("Edge voice could not play this paragraph.");
        setPlayback("idle");
      },
      text: paragraph.text,
      wordRanges
    });
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");

    const credentials = { email, password };
    const { error } =
      authMode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
            ...credentials,
            options: {
              emailRedirectTo: authRedirectUrl()
            }
          });

    if (error) {
      setNotice(error.message);
    } else if (authMode === "sign-up") {
      setNotice("Account created. Check your email if confirmation is enabled.");
    }

    setBusy(false);
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setNotice("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl()
      }
    });

    if (error) {
      setNotice(error.message);
      setBusy(false);
    }
  };

  const signOut = async () => {
    stopAudio();
    await supabase.auth.signOut();
  };

  const startCheckout = async () => {
    setBusy(true);
    setNotice("");

    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      method: "POST"
    });

    if (error) {
      setNotice(error.message);
      setBusy(false);
      return;
    }

    if (!data?.url) {
      setNotice("Checkout did not return a Stripe URL.");
      setBusy(false);
      return;
    }

    window.location.assign(data.url);
  };

  const openBillingPortal = async () => {
    setBusy(true);
    setNotice("");

    const { data, error } = await supabase.functions.invoke("create-billing-portal", {
      method: "POST"
    });

    if (error) {
      setNotice(error.message);
      setBusy(false);
      return;
    }

    if (!data?.url) {
      setNotice("Billing portal did not return a Stripe URL.");
      setBusy(false);
      return;
    }

    window.location.assign(data.url);
  };

  const importEpubFile = async (file: File) => {
    if (!user) return;

    if (!file.name.toLowerCase().endsWith(".epub")) {
      throw new Error("Please select an EPUB file.");
    }

    if (storageUsed + file.size > USER_STORAGE_QUOTA_BYTES) {
      throw new Error(`This upload would exceed your ${formatBytes(USER_STORAGE_QUOTA_BYTES)} library limit.`);
    }

    const parsed = await parseEpub(file);
    const embeddedCoverUrl = parsed.coverUrl ? await shrinkCoverDataUrl(parsed.coverUrl) : "";
    const coverUrl = embeddedCoverUrl || await getOpenLibraryCoverUrl(parsed.title, parsed.author);
    const id = crypto.randomUUID();
    const storagePath = `${user.id}/${id}/${safeFileName(file.name)}`;

    const upload = await supabase.storage.from(EPUB_BUCKET).upload(storagePath, file, {
      contentType: file.type || "application/epub+zip",
      upsert: false
    });

    if (upload.error) throw upload.error;

    const newBook = {
      id,
      user_id: user.id,
      title: parsed.title,
      author: parsed.author,
      cover_url: coverUrl || null,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || "application/epub+zip",
      paragraph_count: parsed.paragraphs.length,
      chapter_count: parsed.chapters.length,
      current_index: 0,
      last_opened_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("books").insert(newBook).select("*").single();

    if (error) {
      await supabase.storage.from(EPUB_BUCKET).remove([storagePath]);
      throw error;
    }

    const row = data as BookRow;
    parsedBooks.current.set(row.id, parsed);
    void cacheBookFile(row, file);
    setCatalogBooks((items) => [row, ...items]);
    openParsedBook(row, parsed, 0);
  };

  const addClassicToLibrary = async (classic: ClassicBook) => {
    if (!user) return;
    stopAudio();
    setPlayback("idle");
    setNotice("");
    setImportingClassicId(classic.id);
    setBusy(true);

    try {
      const response = await fetch(classic.downloadUrl);
      if (!response.ok) throw new Error("Could not download ebook from Standard Ebooks.");

      const blob = await response.blob();
      const filename = `${safeFileName(classic.title)}.epub`;
      const file = new File([blob], filename, { type: "application/epub+zip" });

      await importEpubFile(file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to import classic book.");
    } finally {
      setImportingClassicId(null);
      setBusy(false);
    }
  };

  const handleCatalogUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    stopAudio();
    setPlayback("idle");
    setNotice("");
    setBusy(true);

    try {
      await importEpubFile(file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not upload this EPUB.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const openParsedBook = (row: BookRow, parsed: ReaderBook, targetIndex = row.current_index) => {
    stopAudio();
    setPlayback("idle");
    setNotice("");
    readerImageRunRef.current += 1;
    readerImageModeRef.current = false;
    setReaderImageMode(false);
    setReaderImageAnchorWordOffset(0);
    setReaderImages({});
    imageRequestsRef.current.clear();
    setActiveBookId(row.id);
    setBook(parsed);
    const safeIndex = Math.max(0, Math.min(targetIndex, parsed.paragraphs.length - 1));
    setCurrentIndex(safeIndex);
    pendingScrollIndex.current = safeIndex;
    setView("reader");
  };

  const openBook = async (row: BookRow) => {
    const cached = parsedBooks.current.get(row.id);
    if (cached) {
      openParsedBook(row, cached);
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      let file = await getCachedBookFile(row);

      if (!file) {
        const { data, error } = await supabase.storage.from(EPUB_BUCKET).download(row.storage_path);
        if (error) throw error;
        file = new File([data], row.file_name, { type: row.mime_type || "application/epub+zip" });
        void cacheBookFile(row, file);
      }

      const parsed = await parseEpub(file);
      if (!row.cover_url && parsed.coverUrl) {
        const coverUrl = await shrinkCoverDataUrl(parsed.coverUrl);
        row = { ...row, cover_url: coverUrl };
        setCatalogBooks((items) => items.map((item) => (item.id === row.id ? row : item)));
        const { error: updateError } = await supabase.from("books").update({ cover_url: coverUrl }).eq("id", row.id);
        if (updateError) {
          console.error("Failed to save book cover to database:", updateError);
        }
      }
      parsedBooks.current.set(row.id, parsed);
      openParsedBook(row, parsed);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open this book.");
    } finally {
      setBusy(false);
    }
  };

  const deleteBook = async (row: BookRow) => {
    stopAudio();
    setBusy(true);
    setNotice("");

    const { error } = await supabase.from("books").delete().eq("id", row.id);
    if (error) {
      setNotice(error.message);
      setBusy(false);
      return;
    }

    await supabase.storage.from(EPUB_BUCKET).remove([row.storage_path]);
    void deleteCachedBookFile(row.id);
    parsedBooks.current.delete(row.id);
    void loadReaderImageUsage();
    setCatalogBooks((items) => items.filter((item) => item.id !== row.id));

    if (activeBookId === row.id) {
      setBook(null);
      setActiveBookId("");
      setView("catalog");
    }

    setBusy(false);
  };

  const togglePlayback = () => {
    setNotice("");

    if (playback === "playing") {
      edgeTtsPlayerRef.current?.pause();
      setPlayback("paused");
      return;
    }

    if (playback === "paused") {
      edgeTtsPlayerRef.current?.resume();
      setPlayback("playing");
      return;
    }

    if (!current) return;
    stopAudio();
    setPlayback("playing");
    if (current.kind === "image") {
      if (book && currentIndex < book.paragraphs.length - 1) {
        advance();
      } else {
        setPlayback("idle");
      }
      return;
    }

    speakEdge(current);
  };

  const moveTo = (index: number, options: { scroll?: boolean; stop?: boolean } = {}) => {
    if (!book) return;
    const { scroll = true, stop = true } = options;
    const target = Math.max(0, Math.min(index, book.paragraphs.length - 1));

    if (stop) {
      stopAudio();
      setPlayback("idle");
    }

    if (scroll) pendingScrollIndex.current = target;
    setCurrentIndex(target);
  };

  const moveToChapter = (chapterIndex: number) => {
    if (!book) return;
    const firstParagraph = book.paragraphs.findIndex(
      (paragraph) => paragraph.chapterIndex === chapterIndex
    );
    if (firstParagraph >= 0) moveTo(firstParagraph);
  };

  const openCatalog = () => {
    stopAudio();
    setPlayback("idle");
    if (activeBookId && book) void saveReadingProgress(activeBookId, currentIndex);
    setView("catalog");
  };

  const handleReadingScroll = () => {
    if (!book) return;
    const surface = readingSurfaceRef.current;
    if (playback === "playing" || playback === "paused") return;
    if (!surface) return;

    const viewportTop = surface.getBoundingClientRect().top + 72;
    let closestIndex = currentIndex;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const [index, paragraph] of book.paragraphs.entries()) {
      const node = paragraphRefs.current.get(paragraph.id);
      if (!node) continue;

      const distance = Math.abs(node.getBoundingClientRect().top - viewportTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    if (closestIndex !== currentIndex) setCurrentIndex(closestIndex);
  };

  const setParagraphRef = (id: string) => (node: HTMLElement | null) => {
    if (node) {
      paragraphRefs.current.set(id, node);
    } else {
      paragraphRefs.current.delete(id);
    }
  };

  const renderReaderText = (paragraph: ReaderParagraph) => {
    if (speechHighlight?.paragraphId !== paragraph.id || speechHighlight.end <= speechHighlight.start) {
      return paragraph.text;
    }

    return (
      <>
        {paragraph.text.slice(0, speechHighlight.start)}
        <span className="spoken-word">
          {paragraph.text.slice(speechHighlight.start, speechHighlight.end)}
        </span>
        {paragraph.text.slice(speechHighlight.end)}
      </>
    );
  };

  const renderGeneratedReaderImage = (chunk: ReaderImageChunk) => {
    const image = readerImages[chunk.index];

    return (
      <figure
        className={`reader-generated-image ${chunk.index % 2 === 0 ? "left" : "right"}`}
        key={`generated-${chunk.index}`}
      >
        {image?.status === "ready" && image.src ? (
          <img alt={`Generated visual for words ${chunk.startWord} to ${chunk.endWord}`} src={image.src} />
        ) : (
          <div className={image?.status === "error" ? "reader-generated-placeholder error" : "reader-generated-placeholder"}>
            {image?.status === "loading" ? (
              <Loader2 className="spin" size={22} aria-hidden="true" />
            ) : (
              <ImageIcon size={22} aria-hidden="true" />
            )}
            <span>{image?.status === "error" ? image.error ?? "Image failed" : "Generating image"}</span>
          </div>
        )}
        <figcaption>
          Words {chunk.startWord}-{chunk.endWord}
        </figcaption>
      </figure>
    );
  };

  const scrubToPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!book) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    moveTo(Math.round(ratio * (book.paragraphs.length - 1)));
  };

  const handleProgressKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!book) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(currentIndex - 1);
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(currentIndex + 1);
    }

    if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      moveTo(book.paragraphs.length - 1);
    }
  };

  if (authLoading) {
    return (
      <main className="auth-shell">
        <Loader2 className="spin" size={28} aria-hidden="true" />
      </main>
    );
  }

  if (!session) {
    return (
      <LandingPage
        handleAuth={handleAuth}
        signInWithGoogle={signInWithGoogle}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        authMode={authMode}
        setAuthMode={setAuthMode}
        busy={busy}
        notice={notice}
      />
    );
  }

  if (view === "catalog") {
    return (
      <main className="app-shell catalog-shell">
        <header className="topbar catalog-topbar">
          <div>
            <div className="top-title">Library</div>
            <div className="storage-meter">
              {formatBytes(storageUsed)} of {formatBytes(USER_STORAGE_QUOTA_BYTES)}
            </div>
          </div>
          <div className="top-actions">
            <label className="catalog-upload" title="Upload EPUB">
              {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              <span>Upload EPUB</span>
              <input disabled={busy} type="file" accept=".epub,application/epub+zip" onChange={handleCatalogUpload} />
            </label>
            <button className="top-icon" onClick={signOut} title="Sign out" type="button">
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="catalog-view" aria-label="Book library">
          <div className="catalog-header">
            <h1>Books</h1>
            <div className="billing-strip">
              <div className="billing-plan">
                {isPro ? <Crown size={17} aria-hidden="true" /> : <CreditCard size={17} aria-hidden="true" />}
                <span>{isPro ? "Pro plan" : "Free plan"}</span>
                <small>Pro GBP 12.99/month</small>
                <small>
                  Images {readerImageCount}/{READER_IMAGE_ACCOUNT_LIMIT}
                </small>
                {billingProfile?.status && <small>{billingProfile.status}</small>}
              </div>
              <div className="billing-actions">
                {!isPro && (
                  <button className="primary-small-button" disabled={busy} onClick={() => void startCheckout()} type="button">
                    Upgrade to Pro
                  </button>
                )}
                {billingProfile?.stripe_customer_id && (
                  <button className="secondary-button" disabled={busy} onClick={() => void openBillingPortal()} type="button">
                    Manage billing
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="catalog-list">
            {catalogBooks.length ? (
              catalogBooks.map((catalogBook) => (
                <div
                  className={catalogBook.id === activeBookId ? "catalog-book active" : "catalog-book"}
                  key={catalogBook.id}
                >
                  <button
                    className="catalog-book-open"
                    disabled={busy}
                    onClick={() => void openBook(catalogBook)}
                    type="button"
                  >
                    <BookCover book={catalogBook} />
                    <span className="catalog-book-copy">
                      <strong>{catalogBook.title}</strong>
                      <small>
                        {catalogBook.author || catalogBook.file_name} · {formatBytes(catalogBook.file_size)}
                      </small>
                    </span>
                  </button>
                  <button
                    className="catalog-delete"
                    disabled={busy}
                    onClick={() => void deleteBook(catalogBook)}
                    title="Delete book"
                    type="button"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-library">
                <BookOpen size={22} aria-hidden="true" />
                <span>Your library is empty.</span>
              </div>
            )}
          </div>

          {/* Explore Classics Section */}
          <div className="explore-divider">
            <span>Explore Classics</span>
          </div>

          <div className="explore-section">
            <div className="explore-header">
              <p className="explore-subtitle">
                Fifty timeless masterpieces. Ready to read instantly or download directly.
              </p>
            </div>

            <div className="explore-grid">
              {CURATED_CLASSICS.map((classicBook) => {
                const alreadyAdded = catalogBooks.some(
                  (cb) => cb.title.toLowerCase().trim() === classicBook.title.toLowerCase().trim()
                );
                const isImporting = importingClassicId === classicBook.id;
                const showSynopsis = activeSynopsisId === classicBook.id;

                return (
                  <div className="explore-card" key={classicBook.id}>
                    <div className="explore-cover-container">
                      <img 
                        className="explore-cover" 
                        src={classicBook.coverUrl} 
                        alt={classicBook.title} 
                        loading="lazy"
                      />
                      <div className="explore-cover-overlay">
                        <button
                          className="explore-action-btn primary-action"
                          disabled={busy || isImporting}
                          onClick={() => void addClassicToLibrary(classicBook)}
                          title={alreadyAdded ? "Open from Library" : "Add to Library & Read"}
                          type="button"
                        >
                          {isImporting ? (
                            <Loader2 className="spin" size={16} />
                          ) : alreadyAdded ? (
                            <Check size={16} />
                          ) : (
                            <Plus size={16} />
                          )}
                          <span>{alreadyAdded ? "In Library" : "Add to Library"}</span>
                        </button>
                        
                        <a
                          className="explore-action-btn secondary-action download-link"
                          href={classicBook.downloadUrl}
                          download={`${classicBook.title}.epub`}
                          title="Direct EPUB Download"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download size={16} />
                          <span>Direct EPUB</span>
                        </a>

                        <button
                          className={`explore-action-btn secondary-action ${showSynopsis ? "active" : ""}`}
                          onClick={() => setActiveSynopsisId(showSynopsis ? null : classicBook.id)}
                          title="Show Synopsis"
                          type="button"
                        >
                          <Info size={16} />
                          <span>Synopsis</span>
                        </button>
                      </div>
                    </div>
                    
                    <div className="explore-meta">
                      <h3 className="explore-title" title={classicBook.title}>{classicBook.title}</h3>
                      <p className="explore-author">{classicBook.author}</p>
                    </div>

                    {showSynopsis && (
                      <div className="explore-synopsis-popover">
                        <div className="popover-header">
                          <h4>Synopsis</h4>
                          <button 
                            className="popover-close" 
                            onClick={() => setActiveSynopsisId(null)}
                            type="button"
                          >
                            &times;
                          </button>
                        </div>
                        <p className="popover-text">{classicBook.summary || "No synopsis available."}</p>
                        <div className="popover-footer">
                          <button
                            className="popover-add-btn"
                            disabled={busy || isImporting}
                            onClick={() => {
                              void addClassicToLibrary(classicBook);
                              setActiveSynopsisId(null);
                            }}
                            type="button"
                          >
                            {isImporting ? (
                              <Loader2 className="spin" size={14} />
                            ) : alreadyAdded ? (
                              <Check size={14} />
                            ) : (
                              <Plus size={14} />
                            )}
                            <span>{alreadyAdded ? "In Library" : "Add & Read Now"}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {notice && <div className="notice">{notice}</div>}
      </main>
    );
  }

  if (!book) return null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="top-icon" type="button" title="Back to library" onClick={openCatalog}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="top-title">{book.title}</div>
        <button className="top-icon" onClick={signOut} title="Sign out" type="button">
          <LogOut size={17} aria-hidden="true" />
        </button>
      </header>

      <section className="reader-frame">
        <aside className="chapter-sidebar">
          <div className="chapter-heading">Chapters</div>
          <nav className="chapter-list" aria-label="Chapters">
            {book.chapters.map((chapter, index) => (
              <button
                className={index === current?.chapterIndex ? "chapter-item active" : "chapter-item"}
                key={`${chapter}-${index}`}
                ref={(node) => {
                  if (node) {
                    chapterRefs.current.set(index, node);
                  } else {
                    chapterRefs.current.delete(index);
                  }
                }}
                type="button"
                onClick={() => moveToChapter(index)}
                title={chapter}
              >
                {chapter}
              </button>
            ))}
          </nav>
        </aside>

        <div className={readerImageMode ? "main-spread reader-only image-mode" : "main-spread reader-only"}>
          <section
            className="reading-surface"
            aria-live="polite"
            onScroll={handleReadingScroll}
            ref={readingSurfaceRef}
          >
            <article className={`reader-copy reader-font-${readerFontMode}`}>
              {book.paragraphs.map((paragraph, index) => {
                const showChapterHeading =
                  index === 0 ||
                  paragraph.chapterIndex !== book.paragraphs[index - 1]?.chapterIndex;
                const isChapterHeading =
                  showChapterHeading &&
                  paragraph.kind === "heading" &&
                  paragraph.text.trim().toLowerCase() === paragraph.chapterTitle.trim().toLowerCase();
                const isActive = index === currentIndex;
                const isSpeaking = speechHighlight?.paragraphId === paragraph.id;

                return (
                  <div className="reader-block" key={paragraph.id}>
                    {readerImageInsertions.get(index)?.map((chunk) => renderGeneratedReaderImage(chunk))}
                    {showChapterHeading && !isChapterHeading && (
                      <h2 className="reader-chapter-title">{paragraph.chapterTitle}</h2>
                    )}
                    {paragraph.kind === "image" && paragraph.image ? (
                      <figure
                        className={["reader-image", isActive ? "active" : ""].filter(Boolean).join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        <img alt={paragraph.image.alt} src={paragraph.image.src} />
                        {paragraph.image.alt && <figcaption>{paragraph.image.alt}</figcaption>}
                      </figure>
                    ) : isChapterHeading ? (
                      <h2
                        className={[
                          "reader-chapter-title",
                          isActive ? "reader-current-heading" : "",
                          isSpeaking ? "speaking" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        {renderReaderText(paragraph)}
                      </h2>
                    ) : paragraph.kind === "heading" ? (
                      <h3
                        className={[
                          "reader-heading",
                          isActive ? "active" : "",
                          isSpeaking ? "speaking" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        {renderReaderText(paragraph)}
                      </h3>
                    ) : (
                      <p
                        className={[
                          "reader-paragraph",
                          paragraph.kind === "quote" ? "quote" : "",
                          paragraph.kind === "list" ? "list" : "",
                          isActive ? "active" : "",
                          isSpeaking ? "speaking" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        {renderReaderText(paragraph)}
                      </p>
                    )}
                  </div>
                );
              })}
            </article>
          </section>
        </div>
      </section>

      <div
        className="progress-wrap"
        aria-label="Reading progress"
        aria-valuemax={book.paragraphs.length}
        aria-valuemin={1}
        aria-valuenow={currentIndex + 1}
        onKeyDown={handleProgressKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubToPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) scrubToPointer(event);
        }}
        role="slider"
        tabIndex={0}
        title="Click or drag to jump through the book"
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <footer className="control-rail">
        <div className="font-mode-toggle" aria-label="Reader font">
          <button
            aria-pressed={readerFontMode === "serif"}
            className={readerFontMode === "serif" ? "active" : ""}
            onClick={() => setReaderFontMode("serif")}
            title="Serif font"
            type="button"
          >
            Serif
          </button>
          <button
            aria-pressed={readerFontMode === "sans"}
            className={readerFontMode === "sans" ? "active" : ""}
            onClick={() => setReaderFontMode("sans")}
            title="Sans-serif font"
            type="button"
          >
            Sans
          </button>
        </div>
        <div className="transport">
          <button
            className="rail-icon"
            type="button"
            onClick={() => moveTo(currentIndex - 1)}
            disabled={currentIndex <= 0}
            title="Previous paragraph"
          >
            <RotateCcw size={21} aria-hidden="true" />
          </button>
          <button className="play-button" type="button" onClick={togglePlayback} title="Play or pause">
            {playback === "playing" ? (
              <Pause size={28} aria-hidden="true" />
            ) : (
              <Play size={28} aria-hidden="true" />
            )}
          </button>
          <button
            className="rail-icon"
            type="button"
            onClick={() => moveTo(currentIndex + 1)}
            disabled={currentIndex >= book.paragraphs.length - 1}
            title="Next paragraph"
          >
            <RotateCw size={21} aria-hidden="true" />
          </button>
        </div>
        <div className="image-mode-control">
          <button
            className={readerImageMode ? "secondary-button active" : "secondary-button"}
            disabled={!readerImageMode && !readerImageChunks.length}
            onClick={toggleReaderImageMode}
            title={
              readerImageMode
                ? "Stop generating reading images"
                : "Show reader images"
            }
            type="button"
          >
            {isReaderImageLoading ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <ImageIcon size={16} aria-hidden="true" />
            )}
            <span>{readerImageMode ? "Image mode" : "Generate image"}</span>
          </button>
        </div>
      </footer>

      {notice && <div className="notice">{notice}</div>}
    </main>
  );
}

export default App;
