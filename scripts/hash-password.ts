import { pbkdf2Sync, randomBytes } from 'node:crypto'
const password=process.argv[2]
if(!password){ console.error('Usage: npm run password:hash -- "your password"'); process.exit(1) }
const salt=randomBytes(16).toString('base64url'), iterations=210000
const hash=pbkdf2Sync(password,salt,iterations,32,'sha256').toString('base64url')
console.log(`pbkdf2$${iterations}$${salt}$${hash}`)
