const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

async function main() {
  const markdownPath = '/Users/basti/.gemini/antigravity/brain/1a22ebdd-8f40-4ba2-8b04-3a75fb388f43/datenschutz_muster.md'
  let privacyPolicy = ''
  try {
    privacyPolicy = fs.readFileSync(markdownPath, 'utf8')
  } catch (e) {
    console.error("Could not read markdown file", e)
    return
  }

  await prisma.systemSetting.upsert({
    where: { id: 'privacyPolicy' },
    update: { value: privacyPolicy },
    create: { id: 'privacyPolicy', value: privacyPolicy },
  })
  console.log("Privacy policy seeded successfully.")
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
