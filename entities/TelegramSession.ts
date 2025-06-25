import { ISession, IUser, MessageApp } from "../types.js";
import TelegramBot from "node-telegram-bot-api";
import User from "../models/User.js";
import umami from "../utils/umami.js";
import { splitText } from "../utils/text.utils.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";

export const telegramMessageOption : TelegramBot.SendMessageOptions = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
        selective: true,
        resize_keyboard: true,
    },
};

export class TelegramSession implements ISession {
    messageApp = "Telegram" as MessageApp;
    telegramBot: TelegramBot;
    language_code: string;
    chatId: number;
    user: IUser | null | undefined = undefined;
    isReply: boolean | undefined;

    log = umami.log;

    constructor(telegramBot: TelegramBot, chatId: number, language_code: string) {
        this.telegramBot = telegramBot;
        this.chatId = chatId;
        this.language_code = language_code;
    }

    // try to fetch user from db
    async loadUser() {
        this.user = await User.findOne({ chatId: this.chatId, messageApp: this.messageApp });
        if (this.user != null) { // If the user is known, we update the session language code
            this.language_code=this.user.language_code;
        }
    }

    // Force create a user record
    async createUser() {
        this.user = await User.findOrCreate(this);
    }

    async sendMessage(msg: string, keyboard?: { text: string }[][]) {
        let options = telegramMessageOption;
        if (keyboard != null) {
            options = {
                ...telegramMessageOption, reply_markup: {...(telegramMessageOption.reply_markup), keyboard: keyboard}
            }
        }
        if (msg.length > 3000) {
            await this.sendLongMessage(msg,keyboard);
            return;
        }
        await this.telegramBot.sendMessage(this.chatId, msg, options);
    }

    async sendTypingAction(){
        await this.telegramBot.sendChatAction(this.chatId, "typing");
    }

    async sendLongMessage(
        formattedData: string,
        keyboard?: { text: string }[][]
    ): Promise<void> {
        let optionsWithKeyboard = telegramMessageOption;
        if (keyboard != null) {
            optionsWithKeyboard = {
                ...telegramMessageOption, reply_markup: {...(telegramMessageOption.reply_markup), keyboard: keyboard}
            }
        }
        const mArr = splitText(formattedData, 3000);

        for (let i = 0; i < mArr.length; i++) {
            if (i == mArr.length-1 && keyboard !== undefined) {
                await this.sendMessage(mArr[i], optionsWithKeyboard);
            } else {
                await this.sendMessage(mArr[i], telegramMessageOption);
            }
        }
    }
}

export async function extractTelegramSession(session: ISession, userFacingError?: boolean): Promise<TelegramSession | undefined> {
    if (session.messageApp !== "Telegram") {
        console.log("Session is not a TelegramSession");
        if (userFacingError){
            await session.sendMessage(`Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`, mainMenuKeyboard);
        }
        return undefined;
    }
    if (!(session instanceof TelegramSession)){
        console.log("Session messageApp is Telegram, but session is not a TelegramSession");
        return undefined;
    }

    return session as TelegramSession;
}