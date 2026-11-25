@file:JvmName("Shelf")

package kitchen.recipes

import kotlin.math.max
import kotlin.collections.List as KList

/**
 * A small recipe book. This KDoc says class and "string" but stays a comment.
 */
// One line comment: fun val if "quotes"
/* A block comment /* with a nested one */ that is still a comment */

const val MAX_ITEMS = 1_000
const val MASK = 0xFF
const val FLAGS = 0b1010
const val BIG = 9_000_000_000L
const val SMALL = 7u
const val BOTH = 0xFFuL
const val RATIO = 1.5e10
const val HALF = 2.5f
const val LETTER = 'A'
const val TAB = '\t'
const val QUOTE = '\''

interface Dish {
    val name: String
}

data class Soup(override val name: String, val cups: Int = 2) : Dish

sealed class Step {
    data object Stir : Step()
    class Wait(val minutes: Int) : Step()
}

enum class Measure { CUP, SPOON, GRAM }

@JvmInline
value class Grams(val amount: Int)

@Target(AnnotationTarget.CLASS)
annotation class Tasty

@Tasty
open class Pantry<out T : Dish>(private val dishes: List<T>) {
    var count = 0
        private set

    val size: Int
        get() = dishes.size

    var label: String = ""
        set(value) {
            field = value.trim()
        }

    val greeting by lazy { "Hello from the pantry" }

    init {
        count = dishes.size
    }

    companion object {
        const val DEFAULT_NAME = "pantry"
    }

    // A named value, a variable named data, and a property named value stay plain.
    fun describe(): String {
        val value = 3
        val data = dishes.map { it.name }
        val message = "Pantry $label has ${dishes.size} dishes, total ${value + count}"
        val nested = "outer ${data.joinToString(", ") { "<$it>" }} done"
        val braces = "a map: ${mapOf("k" to "}")} and a dollar ${'$'}"
        val escaped = "price: \$5 and a quote \" and \\"
        val rawText = """
            Line one with $label
            Line two with ${value * 2}
            A "quoted" word, and \n is not an escape
        """.trimIndent()
        val edge = """ends with a quote""""
        return message + nested + braces + escaped + rawText + edge
    }

    suspend fun load(vararg names: String): List<String> {
        return names.filter { it.isNotEmpty() }
    }

    inline fun <reified R> pick(items: List<Any>): R? = items.firstOrNull { it is R } as? R

    infix fun plus(other: Int): Int = count + other
}

fun `my test with spaces`() = 1

fun <T> biggest(items: List<T>): T? where T : Comparable<T> {
    return items.maxOrNull()
}

fun total(numbers: List<Int>?): Int {
    var sum = 0
    numbers?.forEach {
        if (it < 0) return@forEach
        sum += it
    }
    outer@ for (i in 0..<3) {
        for (j in 1..10 step 2) {
            if (j > 5) break@outer
            sum += j
        }
    }
    val first = numbers?.firstOrNull() ?: 0
    val last = numbers!!.last()
    val ref = ::total
    val type = Pantry::class
    return max(sum, first) + last
}

class Outer {
    val text = "outer"

    inner class Inner {
        fun show() = this@Outer.text
    }

    fun describe(vararg parts: Any): String {
        try {
            return parts.joinToString()
        } catch (e: Exception) {
            return "failed"
        } finally {
            println("done")
        }
    }
}

fun main() {
    val pantry = Pantry<Soup>(listOf(Soup("tomato")))
    when (pantry.size) {
        0 -> println("empty")
        in 1..5 -> println("small")
        else -> println("large")
    }
    println(pantry.describe())
}
