if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const Campground = require('../models/campground');
const { indexCampground } = require('../search');

async function run() {
    await mongoose.connect(process.env.DB_URL || 'mongodb://localhost:27017/yelpcamp');
    const campgrounds = await Campground.find({}, '_id title location description embedding').select('+embedding');
    const missing = campgrounds.filter(c => !c.embedding || !c.embedding.length);

    console.log(`Found ${campgrounds.length} campgrounds, ${missing.length} missing embeddings.`);

    for (let i = 0; i < missing.length; i++) {
        await indexCampground(missing[i]);
        if ((i + 1) % 50 === 0 || i + 1 === missing.length) {
            console.log(`Indexed ${i + 1}/${missing.length}`);
        }
    }

    console.log('Backfill complete.');
    await mongoose.connection.close();
}

run().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
