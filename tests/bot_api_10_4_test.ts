import type {
  ApiMethods,
  AreaPosition,
  ChatFullInfo,
  EphemeralMessageParameters,
  InputMessageContent,
  Message,
  RichText,
  TonNft,
  TonWalletCard,
  TonWalletTransfer,
  WidgetQueryType,
} from "../mod.ts";

type Equal<T, U> = (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Methods = ApiMethods<never>;

function assertType<T extends true>(value: T): void {
  if (!value) throw new Error("Unexpected type");
}

Deno.test("Bot API 10.4 declarations", () => {
  assertType<Equal<TonWalletTransfer["amount"], string>>(true);
  assertType<Equal<TonWalletCard["amount"], string>>(true);
  assertType<Equal<TonNft["index"], string>>(true);
  assertType<
    Equal<TonWalletCard["stickers"][number]["position"], AreaPosition>
  >(true);
  assertType<Equal<ChatFullInfo.GroupChat["ton_wallet_card"], undefined>>(true);
  assertType<Equal<ChatFullInfo.GroupChat["share_theme"], undefined>>(true);
  assertType<Equal<Parameters<Methods["getChatShareThemeBackdrops"]>, []>>(
    true,
  );
  assertType<Equal<ReturnType<Methods["sendWidget"]>, Message.WidgetMessage>>(
    true,
  );
  assertType<Equal<ReturnType<Methods["deleteBusinessAccountGift"]>, true>>(
    true,
  );
  assertType<
    Equal<
      { callback_query_id: string } extends EphemeralMessageParameters ? true
        : false,
      true
    >
  >(true);
  assertType<
    Equal<{ html: string } extends InputMessageContent ? true : false, true>
  >(true);
  assertType<
    Equal<
      { widget_id: string } extends InputMessageContent ? true : false,
      true
    >
  >(true);
  assertType<
    Equal<{ html: number } extends InputMessageContent ? true : false, false>
  >(true);
  assertType<
    Equal<{ type: "data" } extends WidgetQueryType ? true : false, true>
  >(true);
  assertType<
    Equal<{ type: "sign_data" } extends WidgetQueryType ? true : false, false>
  >(true);
  assertType<
    Equal<
      { type: "sent_transaction" } extends WidgetQueryType ? true : false,
      false
    >
  >(true);
  assertType<
    Equal<
      { type: "ton_address"; text: string; address: string } extends RichText
        ? true
        : false,
      true
    >
  >(true);
  assertType<
    Equal<
      { type: "ton_address"; text: string; address: number } extends RichText
        ? true
        : false,
      false
    >
  >(true);
  const send: Parameters<Methods["sendMessage"]>[0] = {
    text: "reply",
    ephemeral_message_parameters: { callback_query_id: "callback" },
    reply_parameters: { message_id: 1, quote_rich_texts: ["quote"] },
  };
  assertType<Equal<typeof send.chat_id, number | string | undefined>>(true);
});
