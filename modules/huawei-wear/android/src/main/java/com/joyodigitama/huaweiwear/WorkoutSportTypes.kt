// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiWorkoutGbParser.HuaweiActivityType (Huawei sport
// type byte -> ActivityKind) and model/ActivityKind (isPaceActivity, isSwimActivity). Display names are GB's English
// strings for each ActivityKind (res/values/strings.xml, activity_type_*).
package com.joyodigitama.huaweiwear

/** One Huawei sport type: GB's `ActivityKind` constant name and its English display name. */
internal class Sport(val kind: String, val name: String)

/**
 * Maps the sport type byte of a workout (FitnessData 0x17/0x08 tag 0x14, read unsigned) to GB's names.
 * Unknown types are shown as `Workout (type N)`, GB maps them to `ActivityKind.UNKNOWN`.
 */
internal object WorkoutSportTypes {
  const val UNKNOWN_KIND = "UNKNOWN"

  private val TABLE: Map<Int, Sport> = mapOf(
    1 to Sport("RUNNING", "Running"),
    2 to Sport("WALKING", "Walking"),
    3 to Sport("CYCLING", "Biking"),
    4 to Sport("MOUNTAIN_HIKE", "Mountain Hike"),
    5 to Sport("INDOOR_RUNNING", "Indoor Running"),
    6 to Sport("POOL_SWIM", "Pool Swimming"),
    7 to Sport("INDOOR_CYCLING", "Indoor Cycling"),
    8 to Sport("SWIMMING_OPENWATER", "Swimming (Open water)"),
    11 to Sport("TRAIL_RUN", "Trail run"),
    13 to Sport("INDOOR_WALKING", "Indoor Walking"),
    14 to Sport("HIKING", "Hiking"),
    21 to Sport("JUMP_ROPING", "Jumping Rope"),
    22 to Sport("FREE_DIVING", "Free Diving"),
    23 to Sport("APNEA_TRAINING", "Apnea Training"),
    24 to Sport("APNEA_TEST", "Apnea Test"),
    25 to Sport("SCUBA_DIVING", "SCUBA Diving"),
    128 to Sport("PINGPONG", "Ping Pong"),
    129 to Sport("BADMINTON", "Badminton"),
    130 to Sport("TENNIS", "Tennis"),
    131 to Sport("SOCCER", "Soccer"),
    132 to Sport("BASKETBALL", "Basketball"),
    133 to Sport("VOLLEYBALL", "Volleyball"),
    134 to Sport("ELLIPTICAL_TRAINER", "Elliptical Trainer"),
    135 to Sport("ROWING_MACHINE", "Rowing Machine"),
    136 to Sport("STEPPER", "Stepper"),
    137 to Sport("YOGA", "Yoga"),
    138 to Sport("PILATES", "Pilates"),
    139 to Sport("AEROBICS", "Aerobics"),
    140 to Sport("STRENGTH_TRAINING", "Strength Training"),
    141 to Sport("SPINNING", "Spinning"),
    142 to Sport("AIR_WALKER", "Air walker"),
    143 to Sport("HIIT", "High-intensity Interval Training"),
    145 to Sport("CROSSFIT", "Crossfit"),
    146 to Sport("FUNCTIONAL_TRAINING", "Functional training"),
    147 to Sport("PHYSICAL_TRAINING", "Physical training"),
    148 to Sport("TAEKWONDO", "Taekwondo"),
    149 to Sport("BOXING", "Boxing"),
    150 to Sport("FREE_SPARRING", "Free sparring"),
    151 to Sport("KARATE", "Karate"),
    152 to Sport("FENCING", "Fencing"),
    153 to Sport("BELLY_DANCE", "Belly dance"),
    154 to Sport("JAZZ_DANCE", "Jazz dance"),
    155 to Sport("LATIN_DANCE", "Latin dance"),
    156 to Sport("BALLET", "Ballet"),
    157 to Sport("CORE_TRAINING", "Core Training"),
    158 to Sport("BODY_COMBAT", "Body combat"),
    159 to Sport("KENDO", "Kendo"),
    160 to Sport("HORIZONTAL_BAR", "Horizontal bar"),
    161 to Sport("PARALLEL_BARS", "Parallel bars"),
    162 to Sport("STREET_DANCE", "Street Dance"),
    163 to Sport("ROLLER_SKATING", "Roller skating"),
    164 to Sport("MARTIAL_ARTS", "Martial arts"),
    165 to Sport("PLAZA_DANCING", "Plaza dancing"),
    166 to Sport("TAI_CHI", "Tai chi"),
    167 to Sport("DANCE", "Dance"),
    168 to Sport("HULA_HOOP", "Hula hoop"),
    169 to Sport("FRISBEE", "Frisbee"),
    170 to Sport("DARTS", "Darts"),
    171 to Sport("ARCHERY", "Archery"),
    172 to Sport("HORSE_RIDING", "Horse riding"),
    173 to Sport("LASER_TAG", "Laser tag"),
    174 to Sport("KITE_FLYING", "Kite Flying"),
    175 to Sport("TUG_OF_WAR", "Tug of war"),
    176 to Sport("SWING", "Swing"),
    177 to Sport("STAIRS", "Stairs"),
    178 to Sport("OBSTACLE_RACE", "Obstacle race"),
    179 to Sport("BILLIARD_POOL", "Pool"),
    180 to Sport("BOWLING", "Bowling"),
    181 to Sport("SHUTTLECOCK", "Shuttlecock"),
    182 to Sport("HANDBALL", "Handball"),
    183 to Sport("BASEBALL", "Baseball"),
    184 to Sport("SOFTBALL", "Softball"),
    185 to Sport("CRICKET", "Cricket"),
    186 to Sport("RUGBY", "Rugby"),
    187 to Sport("BEACH_SOCCER", "Beach Soccer"),
    188 to Sport("BEACH_VOLLEYBALL", "Beach Volleyball"),
    189 to Sport("GATEBALL", "Gateball"),
    190 to Sport("HOCKEY", "Hockey"),
    191 to Sport("SQUASH", "Squash"),
    192 to Sport("SEPAK_TAKRAW", "Sepak Takraw"),
    193 to Sport("DODGEBALL", "Dodgeball"),
    194 to Sport("SAILING", "Sailing"),
    195 to Sport("SURFING", "Surfing"),
    196 to Sport("FISHING", "Fishing"),
    197 to Sport("RAFTING", "Rafting"),
    198 to Sport("DRAGON_BOAT", "Dragon boat"),
    199 to Sport("CANOEING", "Canoeing"),
    200 to Sport("ROWING", "Rowing"),
    201 to Sport("WATER_SCOOTER", "Water scooter"),
    202 to Sport("STAND_UP_PADDLEBOARDING", "Standup Paddleboarding"),
    203 to Sport("ICE_SKATING", "Ice Skating"),
    204 to Sport("ICE_HOCKEY", "Ice hockey"),
    205 to Sport("CURLING", "Curling"),
    206 to Sport("BOBSLEIGH", "Bobsleigh"),
    207 to Sport("SLEDDING", "Sledding"),
    208 to Sport("BIATHLON", "Biathlon"),
    209 to Sport("SKATEBOARDING", "Skateboarding"),
    210 to Sport("ROCK_CLIMBING", "Rock climbing"),
    211 to Sport("BUNGEE_JUMPING", "Bungee jumping"),
    212 to Sport("PARKOUR", "Parkour"),
    213 to Sport("BMX", "BMX"),
    214 to Sport("ORIENTEERING", "Orienteering"),
    215 to Sport("PARACHUTING", "Parachuting"),
    216 to Sport("AUTO_RACING", "Auto racing"),
    223 to Sport("ESPORTS", "Esports"),
    224 to Sport("PADEL", "Padel"),
    255 to Sport("EXERCISE", "Exercise"),
  )

  fun sport(type: Int): Sport? = TABLE[type and 0xFF]

  fun name(type: Int): String = sport(type)?.name ?: "Workout (type ${type and 0xFF})"

  /** GB `ActivityKind` constant name, [UNKNOWN_KIND] for types GB does not know. */
  fun kind(type: Int): String = sport(type)?.kind ?: UNKNOWN_KIND

  /** GB `ActivityKind.isSwimActivity`. */
  fun isSwim(kind: String): Boolean = kind.contains("SWIM")

  /** GB `ActivityKind.isPaceActivity`: pace (time per distance) rather than speed is the natural figure. */
  fun isPace(kind: String): Boolean =
    kind.contains("RUN") || kind.contains("SWIM") || kind.contains("TREADMILL") || kind.contains("WALK")

  /** GB `ActivityKind.isDiving` family used for depth readings: free diving and scuba. */
  fun isDiving(kind: String): Boolean = kind == "FREE_DIVING" || kind == "SCUBA_DIVING"
}
