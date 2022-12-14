import 'dotenv/config'
import { providers, Contract } from 'ethers'
import cron from 'node-cron'

import { idRegistryAddr, idRegistryAbi } from './contracts/id-registry.js'
import { IdRegistry, IdRegistryEvents } from './contracts/types/id-registry.js'
import { indexAllCasts } from './functions/index-casts.js'
import { indexVerifications } from './functions/index-verifications.js'
import { upsertAllRegistrations } from './functions/read-logs.js'
import { updateAllProfiles } from './functions/update-profiles.js'
import supabase from './supabase.js'
import { Configuration, OpenAIApi } from 'openai'
import { FlattenedProfile } from './types/index.js'
import { removePuncuation } from './utils.js'

// Set up the provider
const ALCHEMY_SECRET = process.env.ALCHEMY_SECRET
const provider = new providers.AlchemyProvider('goerli', ALCHEMY_SECRET)

// Create ID Registry contract interface
const idRegistry = new Contract(
  idRegistryAddr,
  idRegistryAbi,
  provider
) as IdRegistry

// Listen for new events on the ID Registry
const eventToWatch: IdRegistryEvents = 'Register'
idRegistry.on(eventToWatch, async (to, id) => {
  console.log('New user registered.', Number(id), to)

  const profile: FlattenedProfile = {
    id: Number(id),
    owner: to,
    registered_at: new Date(),
  }

  // Save to supabase
  await supabase.from('profile').insert(profile)
})
const generateMood = async () => {
  const {data, error} = await supabase
  .from('casts')
  .select()
  .is("reply_parent_merkle_root", null)
  .or('text.not.ilike./@([a-zA-Z0-9_]+)/g')
  .eq('deleted', false)
  .eq('recast',false)
  .order('published_at', { ascending: false })
  .limit(8)
if(data) {
const texts = data.map((cast) => cast.text)
let prompt = ''
for(const [index, value] of texts.entries()) {
  prompt = prompt + `#${index + 1}: ${value}\n`
}
const configuration = new Configuration({
  apiKey: process.env.OPENAI_PASSWORD,
});
const openai = new OpenAIApi(configuration);
const response = await openai.createCompletion({
  model: "text-davinci-003",
  prompt: `Given a list of casts, please assign the whole list a rgb hex color, and describe the vibe of the listr:\n#1: Okay I have this dumb thing on Twitter I call "DATABALL". Basically I live tweet a 90 minute coding session. I pretend there's an audience and it helps me focus. I'm banned from Twitter so going to do it here. Feel free to mute. Here we go. THIS. IS. DATABALL!\n#2: What are the best builder communities in Web3? Def, Orange DAO, Alliance, a16z CSS … who else?\n#3: DFW, Broom of the System, this “love” thing: “I think there gets to be sort of a reversal, after a while, and then mostly things don’t matter.” “Reversal? Explain, explain.” https://i.imgur.com/egLtafj.jpg\n#4: Is anyone building a tool that lives on top of Gnosis Safe and allows you to add a note to multisig transactions? E.g. "1 ETH for payroll"\n#5: Hades is one of my favorite video games (highly recommend!) and they just announced Hades II and I'm so happy 🤗 https://www.youtube.com/watch?v=l-iHDj3EwdI\nResponse: #A8B900 - A light yellow-green, conveying a feeling of enthusiasm, curiosity, and energy.\n${prompt}\nResponse:`,
  temperature: 0.65,
  max_tokens: 30,
});
console.log("OPEN AI RES",response.statusText)
const text = response.data.choices[0].text
let regularExpression = /#(?:[0-9a-fA-F]{3}){1,2}/g // btw: this is the same as writing RegExp(/#(?:[0-9a-fA-F]{3}){1,2}/, 'g')
const colors = text && text.match(regularExpression)
const color = colors && colors[0]
let description = text && color && text.substring(text.indexOf(color) + color.length,text.length).trim()
description = description && removePuncuation(description).trim()
const { error: deleteError } = await supabase
.from('mood')
.delete()
.neq("id", 0)
const {data: newCasts, error: addError} = await supabase
.from('mood')
.insert({color,description})
if(!error) {
  return true
}
else {
  console.log("add error",addError)
  return false
}
}
}

const channel = supabase.channel('schema-db-changes').subscribe()
// Make sure we didn't miss any profiles when the indexer was offline
await upsertAllRegistrations(provider, idRegistry)


// Run job every 4 hours
cron.schedule('30 */3 * * *', async () => {
  const mood = await generateMood()
  if(mood) {
    console.log("HAS A MOOD!")
    channel.send({
      type: 'broadcast',
      event: 'mood-update',
      payload: {},
    })
  }
})
// Run job every minute
cron.schedule('* * * * *', async () => {
  await indexAllCasts(10_000)
  await updateAllProfiles()
  channel.send({
    type: 'broadcast',
    event: 'casts-update',
    payload: {},
  })
})

// Run job every hour
cron.schedule('0 * * * *', async () => {
  await indexVerifications()
})
