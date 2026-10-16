export const PASSAGE_BOOK = {
  title: "Pride and Prejudice",
  author: "Jane Austen",
  cover: "/landing/covers/pride-and-prejudice.jpg"
};

export const PASSAGE_IMAGES = [
  "/landing/reader-1.webp",
  "/landing/reader-2.webp",
  "/landing/reader-3.webp",
  "/landing/reader-4.webp"
];

export const PASSAGE_PARAGRAPHS = [
  `"Indeed I have, Sir," was her answer. "She is a great deal too ill to be moved. Mr. Jones says we must not think of moving her. We must trespass a little longer on your kindness."`,
  `"Removed!" cried Bingley. "It must not be thought of. My sister, I am sure, will not hear of her removal."`,
  `"You may depend upon it, Madam," said Miss Bingley, with cold civility, "that Miss Bennet shall receive every possible attention while she remains with us."`,
  `Mrs. Bennet was profuse in her acknowledgments.`,
  `"I am sure," she added, "if it was not for such good friends I do not know what would become of her, for she is very ill indeed, and suffers a vast deal, though with the greatest patience in the world, which is always the way with her, for she has, without exception, the sweetest temper I ever met with."`,
  `"Whatever I do is done in a hurry," replied he; "and therefore if I should resolve to quit Netherfield, I should probably be off in five minutes. At present, however, I consider myself as quite fixed here."`,
  `"That is exactly what I should have supposed of you," said Elizabeth.`,
  `"You begin to comprehend me, do you?" cried he, turning towards her.`,
  `"Oh! yes - I understand you perfectly."`
];

export const passageWords = (paragraphs: string[] = PASSAGE_PARAGRAPHS) =>
  paragraphs.flatMap((paragraph) => paragraph.split(/\s+/));

export type Cover = { title: string; author: string; cover: string };

export const COVERS: Cover[] = [
  ["Pride and Prejudice", "Jane Austen", "pride-and-prejudice"],
  ["Frankenstein", "Mary Shelley", "frankenstein"],
  ["Dracula", "Bram Stoker", "dracula"],
  ["The Great Gatsby", "F. Scott Fitzgerald", "the-great-gatsby"],
  ["Moby-Dick", "Herman Melville", "moby-dick"],
  ["The Picture of Dorian Gray", "Oscar Wilde", "the-picture-of-dorian-gray"],
  ["The Odyssey", "Homer", "the-odyssey"],
  ["Crime and Punishment", "Fyodor Dostoevsky", "crime-and-punishment"],
  ["The Count of Monte Cristo", "Alexandre Dumas", "the-count-of-monte-cristo"],
  ["Jane Eyre", "Charlotte Brontë", "jane-eyre"],
  ["Wuthering Heights", "Emily Brontë", "wuthering-heights"],
  ["The Secret Garden", "Frances Hodgson Burnett", "the-secret-garden"],
  ["Little Women", "Louisa May Alcott", "little-women"],
  ["The Scarlet Letter", "Nathaniel Hawthorne", "the-scarlet-letter"],
  ["A Tale of Two Cities", "Charles Dickens", "a-tale-of-two-cities"],
  ["Treasure Island", "Robert Louis Stevenson", "treasure-island"],
  ["Anne of Green Gables", "L. M. Montgomery", "anne-of-green-gables"],
  ["The Time Machine", "H. G. Wells", "the-time-machine"],
  ["The War of the Worlds", "H. G. Wells", "the-war-of-the-worlds"],
  ["The Wonderful Wizard of Oz", "L. Frank Baum", "the-wonderful-wizard-of-oz"]
].map(([title, author, slug]) => ({ title, author, cover: `/landing/covers/${slug}.jpg` }));

export const LOGO = "/landing/logo.webp";

export const goToApp = () => {
  window.location.href = "/";
};
