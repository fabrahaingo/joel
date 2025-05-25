import { connect, connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import TelegramBot = require("node-telegram-bot-api")

import {describe, expect, test} from '@jest/globals';

import User from "../models/User";

/*
describe('sum module', () => {
    test('adds 1 + 2 to equal 3', () => {
        expect(sum(1, 2)).toBe(3);
    });
});
 */

jest.mock('../utils/umami', () => ({
    log: jest.fn().mockResolvedValue(undefined)
}));

describe('User Model Test Suite', () => {
    let mongoServer: MongoMemoryServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await connect(mongoServer.getUri());
    });

    afterAll(async () => {
        await connection.dropDatabase();
        await connection.close();
        await mongoServer.stop();
    });

    afterEach(async () => {
        await connection.collections.users.deleteMany({});
    });

    describe('Schema Validation', () => {
        it('should create a valid user', async () => {
            const validUser = {
                _id: 123456789,
                chatId: 123456789,
                language_code: 'en',
                status: 'active',
                followedNames: []
            };

            const user = new User(validUser);
            const savedUser = await user.save();

            expect(savedUser._id).toBe(validUser._id);
            expect(savedUser.chatId).toBe(validUser.chatId);
            expect(savedUser.language_code).toBe(validUser.language_code);
            expect(savedUser.status).toBe(validUser.status);
        });

        it('should fail without required fields', async () => {
            const invalidUser = {};

            const user = new User(invalidUser);
            await expect(user.save()).rejects.toThrow();
        });

        it('should set default values', async () => {
            const minimalUser = {
                _id: 123456789,
                chatId: 123456789,
                followedNames: []
            };

            const user = new User(minimalUser);
            const savedUser = await user.save();

            expect(savedUser.language_code).toBe('fr');
            expect(savedUser.status).toBe('active');
            expect(savedUser.followedPeople).toEqual([]);
            expect(savedUser.followedFunctions).toEqual([]);
        });
    });

    describe('Static Methods', () => {
        describe('firstOrCreate', () => {
            const mockTgUser: TelegramBot.User = {
                id: 123456789,
                first_name: 'Test',
                is_bot: false,
                language_code: 'en'
            };

            it('should create a new user if not exists', async () => {
                const user = await User.firstOrCreate({
                    tgUser: mockTgUser,
                    chatId: 123456789
                });

                expect(user._id).toBe(mockTgUser.id);
                expect(user.chatId).toBe(123456789);
                expect(user.language_code).toBe(mockTgUser.language_code);
            });

            it('should return existing user if found', async () => {
                // First create a user
                await User.firstOrCreate({
                    tgUser: mockTgUser,
                    chatId: 123456789
                });

                // Try to create the same user again
                const user = await User.firstOrCreate({
                    tgUser: mockTgUser,
                    chatId: 123456789
                });

                const usersCount = await User.countDocuments();
                expect(usersCount).toBe(1);
                expect(user._id).toBe(mockTgUser.id);
            });

            it('should throw error if no user provided', async () => {
                await expect(User.firstOrCreate({
                    tgUser: undefined,
                    chatId: 123456789
                })).rejects.toThrow('No user provided');
            });
        });
    });

    describe('Instance Methods', () => {
        describe('saveDailyInteraction', () => {
            it('should update lastInteractionDay when undefined', async () => {
                const user = new User({
                    _id: 123456789,
                    chatId: 123456789,
                    followedNames: []
                });
                await user.save();

                await user.saveDailyInteraction();

                expect(user.lastInteractionDay).toBeDefined();
                const today = new Date();
                today.setHours(0, 12, 0, 0);
                expect(user.lastInteractionDay?.getTime()).toBe(today.getTime());
            });

            it('should not update lastInteractionDay if already set for today', async () => {
                const today = new Date();
                today.setHours(0, 12, 0, 0);

                const user = new User({
                    _id: 123456789,
                    chatId: 123456789,
                    lastInteractionDay: today,
                    followedNames: []
                });
                await user.save();

                await user.saveDailyInteraction();

                expect(user.lastInteractionDay?.getTime()).toBe(today.getTime());
            });

            it('should update lastInteractionDay if last interaction was yesterday', async () => {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                yesterday.setHours(0, 12, 0, 0);

                const user = new User({
                    _id: 123456789,
                    chatId: 123456789,
                    lastInteractionDay: yesterday,
                    followedNames: []
                });
                await user.save();

                await user.saveDailyInteraction();

                const today = new Date();
                today.setHours(0, 12, 0, 0);
                expect(user.lastInteractionDay?.getTime()).toBe(today.getTime());
            });
        });
    });
});