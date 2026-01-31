import type { Embed } from "discord.js";
import type { EmbedLike } from "./src/types/index.js";

// Embed が EmbedLike に代入可能か確認
function testCompatibility(embed: Embed): EmbedLike {
  return embed;
}

// readonly 配列への代入確認
function testReadonlyArray(embeds: Embed[]): readonly EmbedLike[] {
  return embeds;
}
