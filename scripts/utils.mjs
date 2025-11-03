import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function run_terminal_cmd({
  command,
  require_user_approval = true,
  is_background = false,
}) {
  try {
    const { stdout, stderr } = await execAsync(command)
    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)
    return { stdout, stderr }
  } catch (error) {
    console.error(`Error executing command: ${error.message}`)
    throw error
  }
}
