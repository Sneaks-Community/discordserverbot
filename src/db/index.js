/**
 * Every export here is synchronous: better-sqlite3 blocks the process for the
 * duration of a query, so awaiting one only implies a yield point that is not
 * there.
 */

export { initDB, closeDB } from "./connection.js";

export { clearEmbedMessage, getEmbedMessage, setEmbedMessage } from "./embedMessage.js";

export {
    followMap,
    unfollowMap,
    countUserFollows,
    getAllFollows,
    getFollowerIds,
    getUserFollows,
    isFollowingMap,
    getUsersFollowingMap,
    unfollowAll
} from "./follows.js";
