import { ISession, IUser, MessageApp } from "../types";
import TelegramBot from "node-telegram-bot-api";
import User from "../models/User";
import umami from "../utils/umami";


export class TelegramSession implements ISession {
    message_app = "Telegram" as MessageApp;
    telegramBot: TelegramBot;
    language_code = "fr"; // Messages in French by default
    chatId: number;
    user: IUser | null | undefined = undefined;

    constructor(telegramBot: TelegramBot, chatId: number) {
        this.telegramBot = telegramBot;
        this.chatId = chatId;
    }

    // try to fetch user from db
    async loadUser() {
        this.user = await User.findOne({ chatId: this.chatId, message_app: this.message_app });
        if (this.user != null) {
            this.language_code=this.user.language_code;
        }
    }

    // Force create a user record
    async createUser() {
        this.user = await User.findOrCreate(this);
    }

    async sendMessage(msg: string) {
        await this.telegramBot.sendMessage(this.chatId, msg);
    }

    async sendTypingAction(){
        await this.telegramBot.sendChatAction(this.chatId, "typing");
    }

    async log(args: { event: string; data?: any }) {
        await umami.log(args);
    }

}