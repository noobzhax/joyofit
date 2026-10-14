package com.joyodigitama.huaweiwear

/**
 * The Healthy Living ("Health Clover") messages of the P2P module `healthmodel`, written from the
 * protobuf descriptors embedded in the generated classes of Huawei Health 17.0.8.300
 * (`com.huawei.basichealthmodel.devicelink.pbjava.{request,report}`, all `proto3`). The field numbers
 * below are read from those descriptors (static analysis; not yet seen on the wire of a Fit 4):
 *
 * ```
 * request.proto  Request      { int32 msgType = 1; float msgVer = 2; bytes msgBody = 3; }
 * requestBody    RequestBody  { int32 recordDay = 1; string requestTaskIds = 2; int32 pageSize = 3; int32 packageSize = 4; }
 * report.proto   Report       { int32 msgType = 1; float msgVer = 2; bytes msgBody = 3; }
 * task.proto     TaskBody     { int32 resultCode = 1; string resultDes = 2; int32 recordDay = 3; string allTasks = 4;
 *                               repeated ReportTask tasks = 5; string completedTasks = 6; bytes cloverProgress = 7; }
 *   ReportTask   { int32 taskId = 1; string taskTarget = 2; string targetDes = 3; string taskValue = 4; int32 status = 5;
 *                  int32 restStatus = 6; int64 timestamp = 7; int32 taskType = 8; string taskName = 9; string unit = 10;
 *                  float progress = 11; string statusDes = 12; }
 *   CloverProgress { float top = 1; float left = 2; float right = 3; float bottom = 4; }
 * notice.proto   NoticeBody   { repeated ReportNotice notices = 1; }
 *   ReportNotice { int32 recordDay = 1; int32 taskId = 2; string taskName = 3; string msg = 4; }
 * ```
 *
 * `msgBody` of a Report holds a serialized TaskBody (`msgType` 2001) or NoticeBody (2002, 2003);
 * `cloverProgress` holds a serialized CloverProgress. Note `msgVer` is a protobuf `float` (Huawei Health
 * reads it into a double, which is why static notes called it a double).
 */
internal object HealthModelMessages {
  /** `HealthModelRequestMessage.Request.msgType` the watch sends to ask for the tasks of a day (`bxr.c`: `msgType == 2001`). */
  const val MSG_TASKS = 2001
  const val MSG_NOTICE_PUSH = 2002
  const val MSG_NOTICE_REPLY = 2003

  /** `Request.msgVer` below which Huawei Health answers with "device version low" (`bxr.a`: `d >= 3.0` skips it). */
  const val VERSION_PAGING = 3.0f

  class RequestBody(
    val recordDay: Int,
    val requestTaskIds: String,
    val pageSize: Int,
    val packageSize: Int,
  )

  class Request(val msgType: Int, val msgVer: Float, val body: ByteArray)

  class Task(
    val taskId: Int,
    val taskTarget: String = "",
    val targetDes: String = "",
    val taskValue: String = "",
    val status: Int = 0,
    val restStatus: Int = 0,
    val timestamp: Long = 0,
    val taskType: Int = 0,
    val taskName: String = "",
    val unit: String = "",
    val progress: Float = 0f,
    val statusDes: String = "",
  )

  class Clover(val top: Float, val left: Float, val right: Float, val bottom: Float)

  class TaskBody(
    val resultCode: Int,
    val resultDes: String,
    val recordDay: Int,
    val allTasks: String,
    val tasks: List<Task>,
    val completedTasks: String,
    val clover: Clover?,
  )

  class Notice(val recordDay: Int, val taskId: Int, val taskName: String, val msg: String)

  fun decodeRequest(data: ByteArray): Request {
    var type = 0
    var ver = 0f
    var body = ByteArray(0)
    for (f in PbReader.fields(data)) {
      when (f.number) {
        1 -> type = f.asInt()
        2 -> ver = f.asFloat()
        3 -> body = f.bytes ?: ByteArray(0)
      }
    }
    return Request(type, ver, body)
  }

  fun decodeRequestBody(data: ByteArray): RequestBody {
    var day = 0
    var ids = ""
    var page = 0
    var pkg = 0
    for (f in PbReader.fields(data)) {
      when (f.number) {
        1 -> day = f.asInt()
        2 -> ids = f.asString()
        3 -> page = f.asInt()
        4 -> pkg = f.asInt()
      }
    }
    return RequestBody(day, ids, page, pkg)
  }

  fun encodeRequest(msgType: Int, msgVer: Float, body: ByteArray): ByteArray =
    PbWriter().intFieldUnlessZero(1, msgType).floatFieldUnlessZero(2, msgVer).bytesFieldUnlessEmpty(3, body).toByteArray()

  fun encodeRequestBody(body: RequestBody): ByteArray =
    PbWriter()
      .intFieldUnlessZero(1, body.recordDay)
      .stringFieldUnlessEmpty(2, body.requestTaskIds)
      .intFieldUnlessZero(3, body.pageSize)
      .intFieldUnlessZero(4, body.packageSize)
      .toByteArray()

  /** `HealthModelReportMessage.Report`, the same layout as [encodeRequest]. */
  fun encodeReport(msgType: Int, msgVer: Float, body: ByteArray): ByteArray = encodeRequest(msgType, msgVer, body)

  fun decodeReport(data: ByteArray): Request = decodeRequest(data)

  fun encodeTask(task: Task): ByteArray =
    PbWriter()
      .intFieldUnlessZero(1, task.taskId)
      .stringFieldUnlessEmpty(2, task.taskTarget)
      .stringFieldUnlessEmpty(3, task.targetDes)
      .stringFieldUnlessEmpty(4, task.taskValue)
      .intFieldUnlessZero(5, task.status)
      .intFieldUnlessZero(6, task.restStatus)
      .longFieldUnlessZero(7, task.timestamp)
      .intFieldUnlessZero(8, task.taskType)
      .stringFieldUnlessEmpty(9, task.taskName)
      .stringFieldUnlessEmpty(10, task.unit)
      .floatFieldUnlessZero(11, task.progress)
      .stringFieldUnlessEmpty(12, task.statusDes)
      .toByteArray()

  fun decodeTask(data: ByteArray): Task {
    var taskId = 0
    var target = ""
    var targetDes = ""
    var value = ""
    var status = 0
    var rest = 0
    var ts = 0L
    var type = 0
    var name = ""
    var unit = ""
    var progress = 0f
    var statusDes = ""
    for (f in PbReader.fields(data)) {
      when (f.number) {
        1 -> taskId = f.asInt()
        2 -> target = f.asString()
        3 -> targetDes = f.asString()
        4 -> value = f.asString()
        5 -> status = f.asInt()
        6 -> rest = f.asInt()
        7 -> ts = f.value
        8 -> type = f.asInt()
        9 -> name = f.asString()
        10 -> unit = f.asString()
        11 -> progress = f.asFloat()
        12 -> statusDes = f.asString()
      }
    }
    return Task(taskId, target, targetDes, value, status, rest, ts, type, name, unit, progress, statusDes)
  }

  fun encodeClover(clover: Clover): ByteArray =
    PbWriter()
      .floatFieldUnlessZero(1, clover.top)
      .floatFieldUnlessZero(2, clover.left)
      .floatFieldUnlessZero(3, clover.right)
      .floatFieldUnlessZero(4, clover.bottom)
      .toByteArray()

  fun decodeClover(data: ByteArray): Clover {
    var top = 0f
    var left = 0f
    var right = 0f
    var bottom = 0f
    for (f in PbReader.fields(data)) {
      when (f.number) {
        1 -> top = f.asFloat()
        2 -> left = f.asFloat()
        3 -> right = f.asFloat()
        4 -> bottom = f.asFloat()
      }
    }
    return Clover(top, left, right, bottom)
  }

  fun encodeTaskBody(body: TaskBody): ByteArray {
    val w = PbWriter()
      .intFieldUnlessZero(1, body.resultCode)
      .stringFieldUnlessEmpty(2, body.resultDes)
      .intFieldUnlessZero(3, body.recordDay)
      .stringFieldUnlessEmpty(4, body.allTasks)
    for (task in body.tasks) w.bytesField(5, encodeTask(task))
    w.stringFieldUnlessEmpty(6, body.completedTasks)
    body.clover?.let { w.bytesFieldUnlessEmpty(7, encodeClover(it)) }
    return w.toByteArray()
  }

  fun decodeTaskBody(data: ByteArray): TaskBody {
    var resultCode = 0
    var resultDes = ""
    var day = 0
    var all = ""
    val tasks = ArrayList<Task>()
    var completed = ""
    var clover: Clover? = null
    for (f in PbReader.fields(data)) {
      when (f.number) {
        1 -> resultCode = f.asInt()
        2 -> resultDes = f.asString()
        3 -> day = f.asInt()
        4 -> all = f.asString()
        5 -> tasks.add(decodeTask(f.bytes ?: ByteArray(0)))
        6 -> completed = f.asString()
        7 -> clover = decodeClover(f.bytes ?: ByteArray(0))
      }
    }
    return TaskBody(resultCode, resultDes, day, all, tasks, completed, clover)
  }

  fun encodeNoticeBody(notices: List<Notice>): ByteArray {
    val w = PbWriter()
    for (n in notices) {
      w.bytesField(
        1,
        PbWriter()
          .intFieldUnlessZero(1, n.recordDay)
          .intFieldUnlessZero(2, n.taskId)
          .stringFieldUnlessEmpty(3, n.taskName)
          .stringFieldUnlessEmpty(4, n.msg)
          .toByteArray(),
      )
    }
    return w.toByteArray()
  }
}
