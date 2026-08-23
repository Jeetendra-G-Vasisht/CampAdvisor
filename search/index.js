const Campground = require('../models/campground');
const { embedText } = require('./embeddings');
const { cosineSimilarity } = require('./similarity');
const vectorCache = require('./vectorCache');

function campgroundText(campground) {
    return [campground.title, campground.location, campground.description]
        .filter(Boolean)
        .join(' — ');
}

async function indexCampground(campground) {
    const vector = await embedText(campgroundText(campground));
    campground.embedding = vector;
    await campground.save();
    await vectorCache.setCampgroundVector(campground._id.toString(), vector);
    return vector;
}

async function getQueryEmbedding(query) {
    const cached = await vectorCache.getQueryVector(query);
    if (cached) return cached;
    const vector = await embedText(query);
    await vectorCache.setQueryVector(query, vector);
    return vector;
}

async function getAllCampgroundVectors() {
    const campgrounds = await Campground.find({}, '_id embedding').select('+embedding');
    const ids = campgrounds.map((c) => c._id.toString());
    const cached = await vectorCache.getCampgroundVectors(ids);

    const vectors = {};
    const toBackfill = [];
    for (const c of campgrounds) {
        const id = c._id.toString();
        if (cached[id]) {
            vectors[id] = cached[id];
        } else if (c.embedding && c.embedding.length) {
            vectors[id] = c.embedding;
            toBackfill.push([id, c.embedding]);
        }
    }
    await Promise.all(toBackfill.map(([id, vector]) => vectorCache.setCampgroundVector(id, vector)));
    return vectors;
}

async function searchCampgrounds(query, { limit = 20 } = {}) {
    const queryVector = await getQueryEmbedding(query);
    const vectors = await getAllCampgroundVectors();

    const ranked = Object.entries(vectors)
        .map(([id, vector]) => ({ id, score: cosineSimilarity(queryVector, vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    const campgrounds = await Campground.find({ _id: { $in: ranked.map((r) => r.id) } });
    const byId = new Map(campgrounds.map((c) => [c._id.toString(), c]));

    return ranked
        .filter((r) => byId.has(r.id))
        .map((r) => ({ campground: byId.get(r.id), score: r.score }));
}

module.exports = { indexCampground, searchCampgrounds };
